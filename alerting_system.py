import asyncio
import json
import logging
from datetime import datetime
from typing import List, Dict, Optional
import aiohttp
import redis.asyncio as redis
from kafka import KafkaProducer

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class AlertingSystem:
    """Real-time alerting and notification system."""
    
    def __init__(self, kafka_servers: List[str], redis_url: str):
        self.kafka_producer = KafkaProducer(
            bootstrap_servers=kafka_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        self.redis_url = redis_url
        self.redis_client: Optional[redis.Redis] = None
        self.alerts: List[Dict] = []
        self.alert_rules = [
            {"name": "high_velocity", "threshold": 85, "metric": "velocity"},
            {"name": "stress_level", "threshold": 7, "metric": "stress"},
            {"name": "data_source_failure", "failures": 3},
        ]
    
    async def initialize(self):
        """Initialize alert system."""
        self.redis_client = await redis.from_url(self.redis_url)
        logger.info("✅ Alert system initialized")
    
    async def evaluate_alerts(self, indices: Dict) -> List[Dict]:
        """Evaluate alert rules against current metrics."""
        triggered_alerts = []
        
        # Check velocity
        if indices.get("Industrial_Velocity", 0) > 85:
            alert = self._create_alert(
                level="CRITICAL",
                name="high_velocity",
                message=f"Industrial velocity exceeds threshold: {indices['Industrial_Velocity']:.2f}"
            )
            triggered_alerts.append(alert)
        
        # Check stress level
        stress_map = {"Low": 2, "Moderate": 5, "High": 8}
        stress_value = stress_map.get(indices.get("Supply_Chain_Stress", "Low"), 5)
        if stress_value > 6:
            alert = self._create_alert(
                level="WARNING",
                name="stress_level",
                message=f"Supply chain stress detected: {indices.get('Supply_Chain_Stress')}"
            )
            triggered_alerts.append(alert)
        
        # Publish alerts
        for alert in triggered_alerts:
            await self.publish_alert(alert)
        
        return triggered_alerts
    
    def _create_alert(self, level: str, name: str, message: str) -> Dict:
        """Create alert object."""
        return {
            "id": f"alert_{datetime.utcnow().timestamp()}",
            "level": level,
            "name": name,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "status": "active"
        }
    
    async def publish_alert(self, alert: Dict):
        """Publish alert to Kafka and store in Redis."""
        try:
            # Publish to Kafka
            self.kafka_producer.send("alerts", value=alert)
            
            # Store in Redis sorted set for retrieval
            if self.redis_client:
                await self.redis_client.zadd(
                    "alerts:recent",
                    {json.dumps(alert): datetime.utcnow().timestamp()}
                )
                
                # Keep only last 100 alerts
                await self.redis_client.zremrangebyrank("alerts:recent", 0, -101)
            
            logger.info(f"🚨 Alert published: {alert['level']} - {alert['message']}")
            
            # Trigger webhooks if configured
            await self._trigger_webhooks(alert)
            
        except Exception as e:
            logger.error(f"❌ Alert publishing error: {e}")
    
    async def _trigger_webhooks(self, alert: Dict):
        """Trigger external webhooks for alerts."""
        webhook_url = "https://your-webhook-endpoint.com/alerts"  # Configure via env
        
        if not webhook_url or webhook_url == "https://your-webhook-endpoint.com/alerts":
            return
        
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    webhook_url,
                    json=alert,
                    timeout=aiohttp.ClientTimeout(total=5)
                )
                logger.info(f"📤 Webhook triggered for alert: {alert['id']}")
        except Exception as e:
            logger.warning(f"⚠️ Webhook trigger failed: {e}")
    
    async def get_recent_alerts(self, limit: int = 10) -> List[Dict]:
        """Get recent alerts from Redis."""
        if not self.redis_client:
            return []
        
        try:
            alerts_data = await self.redis_client.zrange(
                "alerts:recent",
                -limit,
                -1
            )
            return [json.loads(alert) for alert in alerts_data]
        except Exception as e:
            logger.error(f"❌ Error retrieving alerts: {e}")
            return []
    
    async def close(self):
        """Close alert system."""
        self.kafka_producer.close()
        if self.redis_client:
            await self.redis_client.close()
        logger.info("✅ Alert system closed")
