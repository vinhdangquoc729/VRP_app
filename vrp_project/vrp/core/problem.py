# vrp/core/problem.py
from dataclasses import dataclass, field
from typing import List, Dict, Set, Optional, Tuple
import numpy as np

ORDER_TYPE_DELIVERY = 0 
ORDER_TYPE_PICKUP = 1   

@dataclass
class Vehicle:
    id: int
    operating_cost: float
    time_based_cost: float
    type: str = "TRUCK"
    operating_time: int = 12 * 60 * 60
    max_travel_distance: int = 12000000
    max_weight: float = 100
    max_volume: float = 1
    allowed_good_type: List[int] = range(1, 200)
    

@dataclass
class Depot:
    id: int
    x: float
    y: float
    start_time: float = 25200
    end_time: float = 86400
    @property
    def is_depot(self): return True

@dataclass
class GoodsItem:
    id: int
    type: int
    weight: float 
    volume: float
    quantity: int = 1
    

@dataclass
class Order:
    id: int
    good_list: List[GoodsItem]
    weight: float
    volume: float
    customer_id: int
    service_duration: float
    type: int = ORDER_TYPE_PICKUP


@dataclass
class Customer:
    id: int # offset 10000
    x: float
    y: float
    start_time: float
    end_time: float
    order_list: List[Order]
    @property
    def is_depot(self): return False

class Problem:
    def __init__(self, vehicles: List[Vehicle], depots: List[Depot], customers: List[Customer],
                 penalty_weight, distance_matrix, time_matrix, 
                 incompatible_goods_pairs: Set[Tuple[int, int]], big_M: int = 1e9):
        self.vehicles = vehicles
        self.depots = depots
        self.customers = customers
        self.orders: List[Order] = []
        self.penalty_weight = penalty_weight
        for customer in self.customers:
            self.orders.extend(customer.order_list)

        self.distance_matrix = distance_matrix
        self.time_matrix = time_matrix
        self.big_M = big_M
        self.nodes_map = {d.id: d for d in depots}
        self.nodes_map.update({c.id: c for c in customers})

        self.orders_map = {}
        for c in self.customers:
            for o in c.order_list:
                self.orders_map[o.id] = o
                
        self.incompatible_pairs = set()
        if incompatible_goods_pairs:
            for p1, p2 in incompatible_goods_pairs:
                self.incompatible_pairs.add(tuple(sorted((p1, p2))))

    def are_incompatible(self, type1: int, type2: int) -> bool:
        """Check if two goods types are incompatible."""
        return tuple(sorted((type1, type2))) in self.incompatible_pairs
    
    def get_distance(self, u: int, v: int) -> float:
        """Get the distance from u to v, return infinity if no path exists."""
        return self.distance_matrix.get((u, v), float('inf'))

    def get_time(self, u: int, v: int) -> float:
        """Get the time from u to v."""
        return self.time_matrix.get((u, v), float('inf'))