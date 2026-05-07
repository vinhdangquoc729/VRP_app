from dataclasses import dataclass
from typing import List, Dict

@dataclass
class Route: 
    vehicle_id: int 
    seq: List[int] # Node ID, including depot ID at first and last index, middle indexes are customers ID

    @property 
    def start_depot_id(self): 
        return self.seq[0]
    
    @property 
    def end_depot_id(self): 
        return self.seq[-1]

@dataclass
class Solution:
    routes: List[Route] 

    @property
    def journeys(self) -> Dict[int, List[Route]]:
        j = {}
        for r in self.routes:
            j.setdefault(r.vehicle_id, []).append(r)
        return j