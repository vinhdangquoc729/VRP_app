# vrp/core/eval_hard_tw.py
from typing import Tuple, Dict, Set
from collections import defaultdict
from .problem import Problem, Vehicle, Order
from .solution import Solution

def evaluate_hard_tw(problem: Problem, solution: Solution, return_details=True) -> Tuple[float, dict]:
    BIG_PENALTY = 1e14
    BIG_WEIGHT = problem.big_M if problem.big_M else 1e9    
    
    node_to_orders = defaultdict(list)
    for order in problem.orders_map.values():
        node_to_orders[order.customer_id].append(order)

    node_map = {d.id: d for d in problem.depots}
    node_map.update({c.id: c for c in problem.customers})

    details = {
        "objective_cost": 0.0, "total_cost": 0.0,
        "oc": 0.0, "tc": 0.0, "pc": 0.0,
        "num_vehicles": 0, "distance": 0.0,
        "unserved_customers": 0, "capacity_violations": 0,
        "volume_violations": 0,
        "incompatibility_violations": 0, "overtime_violations": 0,
        "overdistance_violations": 0
    }

    served_customer = set()
    for vehicle in problem.vehicles:
        journey = solution.journeys.get(vehicle.id, [])
        if not journey: continue
        
        is_vehicle_used = False
        journey_start_time = -1.0 
        journey_distance = 0.0
        current_time = 0
        
        for route in journey:
            if len(route.seq) <= 2: continue
            
            is_vehicle_used = True
            route_loaded_product_types = set()
            
            if journey_start_time < 0:
                start_node = node_map.get(route.seq[0])
                current_time = start_node.start_time if start_node else 0
                journey_start_time = current_time

            route_weight = 0.0
            route_volume = 0.0
            
            for i in range(1, len(route.seq)):
                u_id, v_id = route.seq[i-1], route.seq[i]
                
                dist = problem.distance_matrix.get((u_id, v_id), 0)
                journey_distance += dist
                details["distance"] += dist
                details["oc"] += (dist / 1000.0) * vehicle.operating_cost
                
                current_time += problem.time_matrix.get((u_id, v_id), 0)
                
                node_v = node_map.get(v_id)
                if node_v:
                    # Check time window (Time Windows)
                    if current_time > node_v.end_time:
                        lateness = current_time - node_v.end_time
                        details["pc"] += lateness * problem.penalty_weight * 1e9
                    elif current_time < node_v.start_time:
                        earliness = node_v.start_time - current_time
                        details["pc"] += earliness * problem.penalty_weight * 1e9
                    
                    if hasattr(node_v, 'order_list'):
                        served_customer.add(v_id)
                        for order in node_v.order_list:
                            # Check incompatibility with vehicle type (Goods-to-Vehicle)
                            for item in order.good_list:
                                if item.type not in vehicle.allowed_good_type:
                                    details["incompatibility_violations"] += 1
                                route_loaded_product_types.add(item.type)
                            
                            route_weight += order.weight
                            route_volume += order.volume
                            current_time += order.service_duration

            # Check incompatibility violations within the same route (Goods-to-Goods)
            for p1, p2 in problem.incompatible_pairs:
                if p1 in route_loaded_product_types and p2 in route_loaded_product_types:
                    details["incompatibility_violations"] += 1

            # Check capacity violations
            if route_weight > vehicle.max_weight:
                details["capacity_violations"] += 1
            if route_volume > vehicle.max_volume:
                details["volume_violations"] += 1

        if is_vehicle_used:
            # Check journey-level constraints
            journey_duration = current_time - journey_start_time
            if journey_duration > vehicle.operating_time:
                details["overtime_violations"] += 1
            
            if journey_distance > vehicle.max_travel_distance:
                details["overdistance_violations"] += 1
                
            details["num_vehicles"] += 1
            details["tc"] += (journey_duration) * vehicle.time_based_cost

    # Evaluate unserved customers and aggregate violations
    details["unserved_customers"] = len(problem.customers) - len(served_customer)
    total_violations = (details["capacity_violations"] + 
                        details["volume_violations"] + 
                        details["incompatibility_violations"] +
                        details["unserved_customers"] + 
                        details["overtime_violations"] +
                        details["overdistance_violations"])
    
    details["total_cost"] = round(details["oc"] + details["tc"] + details["pc"] + (total_violations * BIG_PENALTY), 2)
    details["objective_cost"] = (BIG_WEIGHT * details["num_vehicles"]) + details["total_cost"]
    
    return (details["objective_cost"], details) if return_details else (details["objective_cost"], {})