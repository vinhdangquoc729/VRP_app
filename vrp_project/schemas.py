from pydantic import BaseModel
from typing import List

class OrderSchema(BaseModel):
    id: int
    customer_id: int
    latitude: float
    longitude: float
    weight: float
    volume: float
    start_time: float 
    end_time: float
    service_duration: float

class VRPRequest(BaseModel):
    orders: List[OrderSchema]
    vehicle_ids: List[int] 