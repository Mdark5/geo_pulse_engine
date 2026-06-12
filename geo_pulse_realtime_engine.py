import os
import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import aiohttp
import kafka
from kafka import KafkaProducer, KafkaConsumer
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pykalman import KalmanFilter
import redis.asyncio as redis
from contextlib import asynccontextmanager

# Configure logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Environment variables
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "your-token")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "geopulse")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "industrial-metrics")
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092").split(",")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# API Configuration
SATELLITE_API_URL = os.getenv("SATELLITE_API_URL", "https://api.sentinel-hub.com")
SATELLITE_API_KEY = os.getenv("SATELLITE_API_KEY", "")
ECONOMIC_API_URL = os.getenv("ECONOMIC_API_URL", "https://api.economicdata.com")
ECONOMIC_API_KEY = os.getenv("ECONOMIC_API_KEY", "")
IOT_BROKER_URL = os.getenv("IOT_BROKER_URL", "mqtt://localhost:1883")

class RealTimeDataConnector:
    """Manages connections to live data sources."""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.redis_client: Optional[redis.Redis] = None
        self.influx_client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
        self.write_api = self.influx_client.write_api(write_type=SYNCHRONOUS)
        self.kafka_producer = KafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        self.active_connections: List[WebSocket] = []
        self.data_cache: Dict[str, Any] = {}
        self.failure_count: Dict[str, int] = {}
        self.max_retries = 3
        
    async def initialize(self):
        """Initialize all connections."""
        self.session = aiohttp.ClientSession()
        self.redis_client = await redis.from_url(REDIS_URL)
        logger.info("✅ Real-time connectors initialized")
        
    async def close(self):
        """Close all connections."""
        if self.session:
            await self.session.close()
        if self.redis_client:
            await self.redis_client.close()
        self.kafka_producer.close()
        self.influx_client.close()
        logger.info("✅ Connectors closed")

    async def fetch_satellite_data(self) -> Optional[Dict]:
        """Fetch real-time satellite imagery data."""
        try:
            async with self.session.get(
                f"{SATELLITE_API_URL}/optical",
                headers={"Authorization": f"Bearer {SATELLITE_API_KEY}"},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.failure_count["satellite"] = 0
                    logger.info(f"📡 Satellite data received: {data.get('ndvi', 'N/A')}")
                    return data
        except asyncio.TimeoutError:
            logger.warning("⏱️ Satellite API timeout")
        except Exception as e:
            logger.error(f"❌ Satellite API error: {e}")
        
        self.failure_count["satellite"] = self.failure_count.get("satellite", 0) + 1
        return None

    async def fetch_sar_data(self) -> Optional[Dict]:
        """Fetch SAR (Synthetic Aperture Radar) data - weather-resistant."""
        try:
            async with self.session.get(
                f"{SATELLITE_API_URL}/sar",
                headers={"Authorization": f"Bearer {SATELLITE_API_KEY}"},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.failure_count["sar"] = 0
                    logger.info(f"🛰️ SAR data received: {data.get('backscatter', 'N/A')}")
                    return data
        except Exception as e:
            logger.warning(f"⚠️ SAR API error: {e}")
        
        self.failure_count["sar"] = self.failure_count.get("sar", 0) + 1
        return None

    async def fetch_economic_indicators(self) -> Optional[Dict]:
        """Fetch real-time economic data."""
        try:
            async with self.session.get(
                f"{ECONOMIC_API_URL}/live",
                headers={"Authorization": f"Bearer {ECONOMIC_API_KEY}"},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.failure_count["economic"] = 0
                    logger.info(f"💹 Economic data: Oil={data.get('oil_price')}, Gas={data.get('natural_gas')}")
                    return data
        except Exception as e:
            logger.warning(f"⚠️ Economic API error: {e}")
        
        self.failure_count["economic"] = self.failure_count.get("economic", 0) + 1
        return None

    async def fetch_iot_sensor_stream(self) -> Optional[Dict]:
        """Fetch real-time IoT sensor data from edge devices."""
        try:
            # In production, this would connect to MQTT/IoT Hub
            cached = await self.redis_client.get("iot:latest")
            if cached:
                self.failure_count["iot"] = 0
                return json.loads(cached)
        except Exception as e:
            logger.warning(f"⚠️ IoT data error: {e}")
        
        self.failure_count["iot"] = self.failure_count.get("iot", 0) + 1
        return None

    async def publish_to_kafka(self, topic: str, data: Dict):
        """Publish data to Kafka for streaming processing."""
        try:
            self.kafka_producer.send(topic, value=data)
            logger.debug(f"📤 Published to Kafka topic: {topic}")
        except Exception as e:
            logger.error(f"❌ Kafka publish error: {e}")

    async def write_to_timeseries_db(self, measurement: str, tags: Dict, fields: Dict, timestamp: datetime = None):
        """Write metrics to InfluxDB for time-series analysis."""
        try:
            point = Point(measurement)
            for key, value in tags.items():
                point.tag(key, value)
            for key, value in fields.items():
                point.field(key, float(value) if isinstance(value, (int, float)) else 0)
            if timestamp:
                point.time(timestamp)
            self.write_api.write(bucket=INFLUXDB_BUCKET, record=point)
            logger.debug(f"💾 Written to InfluxDB: {measurement}")
        except Exception as e:
            logger.error(f"❌ InfluxDB write error: {e}")

    async def cache_data(self, key: str, value: Dict, ttl: int = 60):
        """Cache data in Redis for quick access."""
        try:
            await self.redis_client.setex(key, ttl, json.dumps(value))
            self.data_cache[key] = value
        except Exception as e:
            logger.error(f"❌ Redis cache error: {e}")

    async def broadcast_to_websockets(self, message: Dict):
        """Broadcast real-time updates to all connected WebSocket clients."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"❌ WebSocket broadcast error: {e}")

class AutonomousRealtimeEngine:
    """Real-time autonomous monitoring engine."""
    
    def __init__(self, connector: RealTimeDataConnector):
        self.connector = connector
        self.state = "IDLE"
        self.memory = {
            "Layer1_ObservationCache": {},
            "Layer2_FeatureHistory": pd.DataFrame(),
            "Layer3_Baselines": {"velocity": 70.0, "stress": 5.0},
            "Layer4_Seasonality": {},
            "Layer5_EconomicMemory": {},
            "Layer6_ModelPerformance": [],
        }
        self.kalman_filter = KalmanFilter(transition_matrices=[[1, 1], [0, 1]])
        self.last_emission = None
        self.alerts: List[Dict] = []
        
    async def autonomous_realtime_loop(self):
        """Main event loop for real-time processing."""
        while True:
            try:
                self.state = "COLLECT"
                logger.info(f"🔄 State: {self.state}")
                
                # Parallel data acquisition from multiple sources
                satellite_data = await self.connector.fetch_satellite_data()
                sar_data = await self.connector.fetch_sar_data()
                economic_data = await self.connector.fetch_economic_indicators()
                iot_data = await self.connector.fetch_iot_sensor_stream()
                
                raw_data = {
                    "satellite": satellite_data,
                    "sar": sar_data,
                    "economic": economic_data,
                    "iot": iot_data,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # Publish raw data to Kafka
                await self.connector.publish_to_kafka("raw-sensor-data", raw_data)
                
                self.state = "VALIDATE"
                is_valid = any([satellite_data, sar_data, economic_data, iot_data])
                
                if not is_valid:
                    logger.warning("⚠️ No data sources available")
                    await asyncio.sleep(5)
                    continue
                
                self.state = "PROCESS"
                features = await self._extract_features(raw_data)
                
                self.state = "FUSE"
                fused_data = await self._fuse_data(features, economic_data)
                
                self.state = "PREDICT"
                indices = await self._generate_indices(fused_data)
                
                self.state = "ALERT"
                alerts = await self._check_alerts(indices)
                if alerts:
                    self.alerts.extend(alerts)
                    await self.connector.publish_to_kafka("alerts", {"alerts": alerts})
                
                # Store in time-series DB
                await self.connector.write_to_timeseries_db(
                    "industrial_metrics",
                    {"location": "factory-1", "source": "realtime"},
                    {
                        "velocity": indices.get("Industrial_Velocity", 0),
                        "stress": self._stress_to_numeric(indices.get("Supply_Chain_Stress")),
                        "timestamp": datetime.utcnow()
                    }
                )
                
                # Cache latest data
                await self.connector.cache_data("latest:indices", indices, ttl=10)
                
                # Broadcast to WebSocket clients
                await self.connector.broadcast_to_websockets({
                    "type": "update",
                    "state": self.state,
                    "indices": indices,
                    "alerts": alerts,
                    "timestamp": datetime.utcnow().isoformat()
                })
                
                logger.info(f"✅ Cycle complete: Velocity={indices.get('Industrial_Velocity'):.2f}, Stress={indices.get('Supply_Chain_Stress')}")
                
                # Real-time processing with minimal latency
                await asyncio.sleep(2)  # 2-second update cycle
                
            except Exception as e:
                logger.error(f"❌ Loop error: {e}")
                await asyncio.sleep(5)
    
    async def _extract_features(self, raw_data: Dict) -> Dict:
        """Extract features from raw sensor data."""
        features = {}
        
        # From satellite
        if raw_data["satellite"]:
            features["ndvi"] = raw_data["satellite"].get("ndvi", 0)
            features["brightness"] = raw_data["satellite"].get("brightness", 0)
        
        # From SAR (weather-resistant)
        if raw_data["sar"]:
            features["backscatter"] = raw_data["sar"].get("backscatter", 0)
        
        # From IoT sensors
        if raw_data["iot"]:
            features["truck_count"] = raw_data["iot"].get("vehicle_count", 0)
            features["storage_occupancy"] = raw_data["iot"].get("storage_level", 0)
            features["temperature"] = raw_data["iot"].get("temperature", 20)
        
        features["timestamp"] = datetime.utcnow().isoformat()
        return features
    
    async def _fuse_data(self, features: Dict, economic_data: Optional[Dict]) -> Dict:
        """Fuse multiple data sources using Kalman filter."""
        # Kalman filtering for smoothing
        if features.get("ndvi") and self.last_emission is not None:
            state_mean, state_covariance = self.kalman_filter.filter_update(
                self.last_emission,
                None,
                np.array([[features["ndvi"]]])
            )
            self.last_emission = state_mean
        else:
            self.last_emission = np.array([[features.get("ndvi", 0)]])
        
        fused = {
            "vehicle_intensity": features.get("truck_count", 0) * 2.5,
            "storage_intensity": features.get("storage_occupancy", 0),
            "environmental_factor": features.get("temperature", 20) / 30,
        }
        
        if economic_data:
            fused["economic_index"] = economic_data.get("composite_index", 50)
            fused["fuel_impact"] = economic_data.get("fuel_price", 3.5) * 1.5
        
        return fused
    
    async def _generate_indices(self, fused_data: Dict) -> Dict:
        """Generate real-time indices."""
        velocity = (fused_data["vehicle_intensity"] * 0.4 +
                   fused_data["storage_intensity"] * 0.3 +
                   fused_data.get("economic_index", 50) * 0.3)
        
        stress_score = (abs(velocity - self.memory["Layer3_Baselines"]["velocity"]) +
                       fused_data["environmental_factor"] * 3)
        
        if stress_score < 3:
            stress = "Low"
        elif stress_score < 6:
            stress = "Moderate"
        else:
            stress = "High"
        
        return {
            "Industrial_Velocity": velocity,
            "Supply_Chain_Stress": stress,
            "Economic_Factor": fused_data.get("economic_index", 50),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def _check_alerts(self, indices: Dict) -> List[Dict]:
        """Check for alert conditions."""
        alerts = []
        
        if indices["Industrial_Velocity"] > 85:
            alerts.append({
                "level": "CRITICAL",
                "message": f"High industrial activity: {indices['Industrial_Velocity']:.2f}",
                "timestamp": datetime.utcnow().isoformat()
            })
        
        if indices["Supply_Chain_Stress"] == "High":
            alerts.append({
                "level": "WARNING",
                "message": "Supply chain stress detected",
                "timestamp": datetime.utcnow().isoformat()
            })
        
        return alerts
    
    def _stress_to_numeric(self, stress: str) -> float:
        mapping = {"Low": 2, "Moderate": 5, "High": 8}
        return mapping.get(stress, 5)

# FastAPI Application
connector = RealTimeDataConnector()
engine = AutonomousRealtimeEngine(connector)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connector.initialize()
    asyncio.create_task(engine.autonomous_realtime_loop())
    logger.info("🚀 Application startup complete")
    yield
    # Shutdown
    await connector.close()
    logger.info("🛑 Application shutdown")

app = FastAPI(
    title="GeoPulse Real-Time Autonomous Engine",
    description="Real-time industrial monitoring with live data streams",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket for real-time updates
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connector.active_connections.append(websocket)
    logger.info(f"✅ WebSocket connected. Total: {len(connector.active_connections)}")
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        connector.active_connections.remove(websocket)
        logger.info(f"❌ WebSocket disconnected. Total: {len(connector.active_connections)}")
    except Exception as e:
        logger.error(f"❌ WebSocket error: {e}")

# REST Endpoints
@app.get("/status")
async def status():
    """Get current system status."""
    return {
        "state": engine.state,
        "timestamp": datetime.utcnow().isoformat(),
        "connected_clients": len(connector.active_connections),
        "failure_counts": connector.failure_count,
        "recent_alerts": engine.alerts[-5:] if engine.alerts else []
    }

@app.get("/metrics/live")
async def live_metrics():
    """Get latest metrics from cache."""
    cached = await connector.redis_client.get("latest:indices")
    if cached:
        return json.loads(cached)
    return {"message": "No data yet"}

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

@app.get("/alerts")
async def get_alerts(limit: int = 10):
    """Get recent alerts."""
    return engine.alerts[-limit:] if engine.alerts else []

@app.get("/data-sources")
async def data_sources():
    """Check availability of data sources."""
    return {
        "satellite": connector.failure_count.get("satellite", 0) < 3,
        "sar": connector.failure_count.get("sar", 0) < 3,
        "economic": connector.failure_count.get("economic", 0) < 3,
        "iot": connector.failure_count.get("iot", 0) < 3,
        "cache": len(connector.data_cache)
    }

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
