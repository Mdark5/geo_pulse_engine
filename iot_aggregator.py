import asyncio
import json
import logging
from typing import Optional
import paho.mqtt.client as mqtt
from datetime import datetime
import redis.asyncio as redis

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class IoTSensorAggregator:
    """Aggregates real-time data from IoT devices via MQTT."""
    
    def __init__(self, mqtt_broker: str = "localhost", mqtt_port: int = 1883):
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.broker = mqtt_broker
        self.port = mqtt_port
        self.redis_client: Optional[redis.Redis] = None
        self.sensor_data = {}
        
    async def initialize(self):
        """Initialize MQTT and Redis connections."""
        self.redis_client = await redis.from_url("redis://localhost:6379")
        self.client.connect(self.broker, self.port, keepalive=60)
        self.client.loop_start()
        logger.info(f"✅ Connected to MQTT broker at {self.broker}:{self.port}")
    
    def on_connect(self, client, userdata, connect_flags, reason_code, properties):
        """MQTT connection callback."""
        if reason_code == 0:
            logger.info("✅ MQTT Connected successfully")
            # Subscribe to sensor topics
            client.subscribe("sensors/vehicles/count")
            client.subscribe("sensors/storage/level")
            client.subscribe("sensors/environment/temperature")
            client.subscribe("sensors/equipment/status")
        else:
            logger.error(f"❌ MQTT connection failed: {reason_code}")
    
    def on_message(self, client, userdata, msg):
        """MQTT message callback."""
        try:
            payload = json.loads(msg.payload.decode())
            topic = msg.topic
            
            # Process sensor data
            self.sensor_data[topic] = {
                "value": payload.get("value"),
                "timestamp": datetime.utcnow().isoformat(),
                "device_id": payload.get("device_id"),
                "location": payload.get("location")
            }
            
            logger.info(f"📨 Received from {topic}: {payload.get('value')}")
            
            # Write to Redis for real-time access
            asyncio.create_task(self._cache_sensor_data(topic, payload))
            
        except Exception as e:
            logger.error(f"❌ MQTT message error: {e}")
    
    async def _cache_sensor_data(self, topic: str, data: dict):
        """Cache sensor data in Redis."""
        if self.redis_client:
            try:
                await self.redis_client.setex(
                    f"iot:{topic}",
                    60,
                    json.dumps(data)
                )
            except Exception as e:
                logger.error(f"Redis cache error: {e}")
    
    async def aggregate_sensor_data(self) -> dict:
        """Aggregate all sensor data."""
        aggregated = {
            "vehicle_count": 0,
            "storage_level": 0,
            "temperature": 20,
            "equipment_status": "normal",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        if self.sensor_data:
            vehicles = self.sensor_data.get("sensors/vehicles/count", {})
            aggregated["vehicle_count"] = vehicles.get("value", 0)
            
            storage = self.sensor_data.get("sensors/storage/level", {})
            aggregated["storage_level"] = storage.get("value", 0)
            
            temp = self.sensor_data.get("sensors/environment/temperature", {})
            aggregated["temperature"] = temp.get("value", 20)
            
            status = self.sensor_data.get("sensors/equipment/status", {})
            aggregated["equipment_status"] = status.get("value", "normal")
        
        # Cache aggregated data
        if self.redis_client:
            await self.redis_client.setex(
                "iot:latest",
                10,
                json.dumps(aggregated)
            )
        
        return aggregated
    
    async def close(self):
        """Close connections."""
        self.client.loop_stop()
        self.client.disconnect()
        if self.redis_client:
            await self.redis_client.close()
        logger.info("✅ IoT aggregator closed")

class StreamProcessor:
    """Process streaming data from Kafka."""
    
    def __init__(self, bootstrap_servers):
        self.bootstrap_servers = bootstrap_servers
        self.consumer = None
        
    def start_consuming(self, topic: str):
        """Start consuming messages from Kafka topic."""
        from kafka import KafkaConsumer
        
        self.consumer = KafkaConsumer(
            topic,
            bootstrap_servers=self.bootstrap_servers,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            group_id='realtime-processor'
        )
        
        logger.info(f"📊 Started consuming from topic: {topic}")
        
        for message in self.consumer:
            logger.info(f"📤 Processing: {message.value}")
            yield message.value
    
    def stop_consuming(self):
        """Stop consuming messages."""
        if self.consumer:
            self.consumer.close()
            logger.info("✅ Consumer stopped")
