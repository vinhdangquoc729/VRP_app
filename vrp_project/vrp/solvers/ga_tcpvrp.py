import random
import time
import copy
import numpy as np
from typing import List, Dict, Tuple
from collections import defaultdict, OrderedDict

from ..core.problem import Problem
from ..core.solution import Solution, Route
from ..core.eval import evaluate
from dataclasses import dataclass

@dataclass
class Head:
    """Head chromosome."""
    priority: List[int]             
    routes_per_journey: List[int]   
    nodes_per_route: List[int]      
    orders_per_node: List[int]          

@dataclass
class EncodedSolution:
    """Encoded solution structure: Head-Core-Tail."""
    head: Head
    core: List[List[int]]           # Sequence of locations (Depots & Customers)
    tail: List[List[int]]           # List of orders at each customer

class GA_TCPVRP_Solver:
    def __init__(self, problem: Problem, seed: int = 42, evaluator=evaluate, **kwargs):
        self.prob = problem
        self.evaluator = evaluator
        self.seed = seed
        random.seed(seed)
        np.random.seed(seed)

        self.pop_size = kwargs.get("pop_size", 100)
        self.n_generations = kwargs.get("n_generations", 500)
        self.p_crossover = kwargs.get("p_crossover", 0.96)
        self.p_mutation = kwargs.get("p_mutation", 0.16)
        self.elite_rate = kwargs.get("elite_rate", 0.10)
        self.k_power = kwargs.get("k_power", 1.0) # Power-law scaling factor

    def _decode(self, encoded: EncodedSolution) -> Solution:
        """Decode the chromosome."""
        routes = []
        current_route_idx = 0
        for i, vehicle_id in enumerate(encoded.head.priority):
            num_routes = encoded.head.routes_per_journey[i]
            for _ in range(num_routes):
                if current_route_idx < len(encoded.core):
                    routes.append(Route(vehicle_id=vehicle_id, seq=encoded.core[current_route_idx]))
                    current_route_idx += 1
        return Solution(routes=routes)

    def _initialize_population(self) -> List[EncodedSolution]:
        """
        Initialize population F0:
        - Greedy (Nearest Neighbor).
        - Multi-trip.
        - Weight, Volume, Incompatible goods, Operating Time, Max Travel Distance.
        """
        population = []
        all_vehs = self.prob.vehicles
        depot_id = self.prob.depots[0].id
        depot_start_t = self.prob.nodes_map[depot_id].start_time
        
        TURNAROUND_TIME = 15.0

        for p_idx in range(self.pop_size):
            unassigned_custs = [c.id for c in self.prob.customers]
            shuffled_vehs = list(all_vehs)
            random.shuffle(shuffled_vehs)
            
            veh_to_routes_data = {v.id: [] for v in shuffled_vehs}
            veh_total_time = {v.id: 0.0 for v in shuffled_vehs}
            veh_total_dist = {v.id: 0.0 for v in shuffled_vehs}
            
            for vehicle in shuffled_vehs:
                if not unassigned_custs: break
                
                while True: # Multi-trip loop
                    current_route_c = []
                    curr_w, curr_v = 0.0, 0.0
                    curr_goods = set()
                    
                    prep_time = TURNAROUND_TIME if veh_to_routes_data[vehicle.id] else 0.0
                    curr_time = depot_start_t + veh_total_time[vehicle.id] + prep_time
                    
                    route_dist = 0.0
                    last_node_id = depot_id
                    
                    while True: # Greedy Insertion Loop
                        best_candidate_id = None
                        min_dist = float('inf')
                        
                        for cid in unassigned_custs:
                            cust = self.prob.nodes_map[cid]
                            
                            c_goods = {it.type for o in cust.order_list for it in o.good_list}
                            if not c_goods.issubset(vehicle.allowed_good_type): continue
                            
                            if any(self.prob.are_incompatible(g1, g2) for g1 in c_goods for g2 in curr_goods):
                                continue

                            c_w = sum(o.weight for o in cust.order_list)
                            c_v = sum(o.volume for o in cust.order_list)
                            if curr_w + c_w > vehicle.max_weight or curr_v + c_v > vehicle.max_volume:
                                continue

                            travel_t = self.prob.get_time(last_node_id, cid)
                            arrival_t = max(curr_time + travel_t, cust.start_time)
                            
                            if arrival_t > cust.end_time: continue 
                                
                            finish_t = arrival_t + sum(o.service_duration for o in cust.order_list)
                            back_t = self.prob.get_time(cid, depot_id)
                            
                            total_op_time = (finish_t + back_t) - depot_start_t
                            if total_op_time > vehicle.operating_time: continue

                            travel_d = self.prob.get_distance(last_node_id, cid)
                            back_d = self.prob.get_distance(cid, depot_id)
                            total_journey_d = veh_total_dist[vehicle.id] + route_dist + travel_d + back_d
                            if total_journey_d > vehicle.max_travel_distance: continue

                            d = self.prob.get_distance(last_node_id, cid)
                            if d < min_dist:
                                min_dist = d
                                best_candidate_id = cid
                                
                        if best_candidate_id is not None:
                            current_route_c.append(best_candidate_id)
                            target_cust = self.prob.nodes_map[best_candidate_id]
                            
                            curr_w += sum(o.weight for o in target_cust.order_list)
                            curr_v += sum(o.volume for o in target_cust.order_list)
                            curr_goods.update({it.type for o in target_cust.order_list for it in o.good_list})
                            
                            t_move = self.prob.get_time(last_node_id, best_candidate_id)
                            d_move = self.prob.get_distance(last_node_id, best_candidate_id)
                            
                            curr_time = max(curr_time + t_move, target_cust.start_time) + \
                                         sum(o.service_duration for o in target_cust.order_list)
                            route_dist += d_move
                            
                            last_node_id = best_candidate_id
                            unassigned_custs.remove(best_candidate_id)
                        else:
                            break
                    
                    if current_route_c:
                        final_back_t = self.prob.get_time(last_node_id, depot_id)
                        final_back_d = self.prob.get_distance(last_node_id, depot_id)
                        
                        veh_to_routes_data[vehicle.id].append({'d': depot_id, 'c': current_route_c})
                        
                        veh_total_time[vehicle.id] = (curr_time + final_back_t) - depot_start_t
                        veh_total_dist[vehicle.id] += route_dist + final_back_d
                    else:
                        break 

            priority = [v.id for v in all_vehs]
            core, tail, routes_per_journey = [], [], []
            nodes_per_route, orders_per_node = [], []

            for v_id in priority:
                assigned = veh_to_routes_data[v_id]
                routes_per_journey.append(len(assigned))
                for rd in assigned:
                    seq = [rd['d']] + rd['c'] + [rd['d']]
                    core.append(seq)
                    nodes_per_route.append(len(seq))
                    r_orders = []
                    for cid in rd['c']:
                        orders_per_node.append(len(self.prob.nodes_map[cid].order_list))
                        r_orders.extend([o.id for o in self.prob.nodes_map[cid].order_list])
                    tail.append(r_orders)

            population.append(EncodedSolution(
                head=Head(priority, routes_per_journey, nodes_per_route, orders_per_node),
                core=core, tail=tail
            ))
            
        return population

    def _evaluate_population(self, population: List[EncodedSolution]) -> Tuple[List[float], int]:
        """Calculate fitness for each individual in the population."""
        objs = np.array([self.evaluator(self.prob, self._decode(ind))[0] for ind in population])
        
        a_max = np.max(objs)
        a_min = np.min(objs)
        
        fitness = (a_max - objs) ** self.k_power - a_min
        
        return fitness.tolist(), int(np.argmin(objs))

    def _best_cost_route_crossover(self, p1: EncodedSolution, p2: EncodedSolution) -> EncodedSolution:
        # Extract a high-quality route from p2 and insert it into p1
        valid_p2 = [r for r in p2.core if len(r) > 2]
        if not valid_p2: return p1
        r2 = random.choice(valid_p2)
        c_nodes = r2[1:-1]
        s, e = sorted(random.sample(range(len(c_nodes) + 1), 2))
        segment = c_nodes[s:e]
        if not segment: return p1

        # 2. Clean p1 core
        cleaned_core = [[n for n in r if n not in segment] for r in p1.core]

        # 3. Insert into some positions
        all_positions = [(r_idx, pos) for r_idx, r in enumerate(cleaned_core) for pos in range(1, len(r))]
        test_positions = random.sample(all_positions, min(10, len(all_positions)))

        best_core = None
        min_obj = float('inf')

        # 4. Try inserting
        for r_idx, pos in test_positions:
            temp_core = list(cleaned_core)
            temp_route = list(temp_core[r_idx])
            
            temp_route[pos:pos] = segment
            temp_core[r_idx] = temp_route
            
            tmp_encoded = EncodedSolution(head=p1.head, core=temp_core, tail=p1.tail)
            cost = self.evaluator(self.prob, self._decode(tmp_encoded))[0]
            
            if cost < min_obj:
                min_obj = cost
                best_core = temp_core

        if best_core and min_obj <= self.evaluator(self.prob, self._decode(p1))[0]:
            return EncodedSolution(head=p1.head, core=best_core, tail=p1.tail)
        
        return p1

    def _mutate(self, p: EncodedSolution) -> EncodedSolution:
        """
        Mutation: Reverse a segment within a route.
        """
        valid_indices = [i for i, r in enumerate(p.core) if len(r) >= 4]
        if not valid_indices:
            return p
        r_idx = random.choice(valid_indices)
        new_core = list(p.core) 
        target_route = list(new_core[r_idx])
        idx1, idx2 = sorted(random.sample(range(1, len(target_route) - 1), 2))
        target_route[idx1:idx2+1] = target_route[idx1:idx2+1][::-1]
        new_core[r_idx] = target_route
        new_p = EncodedSolution(head=p.head, core=new_core, tail=p.tail)
        if self.evaluator(self.prob, self._decode(new_p))[0] <= self.evaluator(self.prob, self._decode(p))[0]:
            return new_p
        return p
    
    def _mutate_transfer_route(self, p: EncodedSolution, best_value) -> EncodedSolution:
        """
        Mutation: Transfer a route from one vehicle to another.
        """
        # 1. Calculate number of customers per vehicle
        veh_customer_counts = []
        curr = 0
        for count in p.head.routes_per_journey:
            v_routes = p.core[curr : curr + count]
            total_cust = sum(len(r) - 2 for r in v_routes)
            veh_customer_counts.append(total_cust)
            curr += count

        non_empty_veh_indices = [i for i, count in enumerate(veh_customer_counts) if count > 0]
        
        if not non_empty_veh_indices: 
            return p

        # 2. Choose Source Vehicle       
        weights = [1 for i in non_empty_veh_indices]
        
        src_v_idx = random.choices(non_empty_veh_indices, weights=weights, k=1)[0]
        src_v_id = p.head.priority[src_v_idx]
        
        # 3. Choose Route to Move
        src_start_core_idx = sum(p.head.routes_per_journey[:src_v_idx])
        src_route_count = p.head.routes_per_journey[src_v_idx]
        
        rel_r_idx = random.randint(0, src_route_count - 1)
        abs_r_idx = src_start_core_idx + rel_r_idx
        route_to_move = p.core[abs_r_idx]

        if len(route_to_move) <= 2:
            return p

        # 4. Choose Destination Vehicle
        dest_v_idx = random.choice([i for i in range(len(p.head.priority)) if i != src_v_idx])
        dest_v_id = p.head.priority[dest_v_idx]
        
        dest_vehicle = next((v for v in self.prob.vehicles if v.id == dest_v_id), None)
        if not dest_vehicle: return p

        # 5. Check feasibility
        route_goods = set()
        for node_id in route_to_move[1:-1]:
            cust = self.prob.nodes_map.get(node_id)
            if cust:
                for o in cust.order_list:
                    for item in o.good_list:
                        route_goods.add(item.type)
        
        if not route_goods: return p

        if not all(g in dest_vehicle.allowed_good_type for g in route_goods):
            return p

        dest_start_core_idx = sum(p.head.routes_per_journey[:dest_v_idx])
        dest_count = p.head.routes_per_journey[dest_v_idx]
        dest_existing_routes = p.core[dest_start_core_idx : dest_start_core_idx + dest_count]
        
        dest_existing_goods = set()
        for r in dest_existing_routes:
            for nid in r[1:-1]:
                cust = self.prob.nodes_map.get(nid)
                if cust:
                    for o in cust.order_list:
                        for item in o.good_list:
                            dest_existing_goods.add(item.type)
        
        is_conflict = False
        for g1 in route_goods:
            for g2 in dest_existing_goods:
                if self.prob.are_incompatible(g1, g2):
                    is_conflict = True; break
            if is_conflict: break
        
        if is_conflict: return p

        grouped_core, grouped_tail = [], []
        curr = 0
        for count in p.head.routes_per_journey:
            grouped_core.append(p.core[curr : curr + count])
            grouped_tail.append(p.tail[curr : curr + count])
            curr += count
            
        new_grouped_core = copy.deepcopy(grouped_core)
        new_grouped_tail = copy.deepcopy(grouped_tail)
        
        moved_route = new_grouped_core[src_v_idx].pop(rel_r_idx)
        moved_tail_data = new_grouped_tail[src_v_idx].pop(rel_r_idx)
        
        new_grouped_core[dest_v_idx].append(moved_route)
        new_grouped_tail[dest_v_idx].append(moved_tail_data)
        
        # 7. Restructure new solution
        new_core = [r for v_list in new_grouped_core for r in v_list]
        new_tail = [t for v_list in new_grouped_tail for t in v_list]
        
        new_head = copy.deepcopy(p.head)
        new_head.routes_per_journey[src_v_idx] -= 1
        new_head.routes_per_journey[dest_v_idx] += 1
        new_head.nodes_per_route = [len(r) for r in new_core]
        
        new_orders_per_node = []
        for r in new_core:
            for nid in r[1:-1]:
                cust = self.prob.nodes_map.get(nid)
                if cust:
                    new_orders_per_node.append(len(cust.order_list))
        new_head.orders_per_node = new_orders_per_node
        
        new_sol = EncodedSolution(head=new_head, core=new_core, tail=new_tail)

        if self.evaluator(self.prob, self._decode(new_sol))[0] <= self.evaluator(self.prob, self._decode(p))[0]:
            return new_sol
        
        return p

    def solve(self, time_limit_sec: float = 60.0) -> Solution:
        start = time.time()
        pop = self._initialize_population()
        best_enc, best_obj = None, float('inf')
        
        for gen in range(self.n_generations):
            # print(gen)
            if (time.time() - start) > time_limit_sec: break
            fit, b_idx = self._evaluate_population(pop) 
            
            c_best_enc = pop[b_idx]
            c_obj = self.evaluator(self.prob, self._decode(c_best_enc))[0]
            if c_obj < best_obj:
                best_obj, best_enc = c_obj, copy.deepcopy(c_best_enc)
                print(f"Gen {gen}: Best Cost = {best_obj}")

            new_pop = self._get_elites(pop, fit)
            while len(new_pop) < self.pop_size:
                p1, p2 = self._selection(pop, fit), self._selection(pop, fit)
                off = self._best_cost_route_crossover(p1, p2) if random.random() < self.p_crossover else copy.deepcopy(p1)
                if random.random() < self.p_mutation: 
                    if random.random() < 0.8:
                        off = self._mutate(off)
                    if random.random() < 0.8:
                        off = self._mutate_transfer_route(off, self.evaluator(self.prob, self._decode(best_enc))[0])
                new_pop.append(off)
            pop = new_pop
        return self._decode(best_enc) if best_enc else self._decode(pop[0])
    
    def _selection(self, population: List[EncodedSolution], fitness: List[float]) -> EncodedSolution:
        """
        Tournament selection (k = 2).
        """
        idx1, idx2 = random.sample(range(len(population)), 2)
        
        if fitness[idx1] > fitness[idx2]:
            return population[idx1]
        else:
            return population[idx2]

    def _get_elites(self, population: List[EncodedSolution], fitness: List[float]) -> List[EncodedSolution]:
        """
        Get elite individuals to carry over to the next generation.
        """
        n_elites = max(1, int(self.pop_size * self.elite_rate))
        
        elite_indices = np.argsort(fitness)[-n_elites:]
        
        return [copy.deepcopy(population[i]) for i in elite_indices]