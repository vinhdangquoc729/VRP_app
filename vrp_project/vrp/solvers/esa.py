from __future__ import annotations
import math
import random
import time
import copy
import os
from typing import List, Tuple, Dict, Set
from collections import defaultdict

from ..core.problem import Problem
from ..core.solution import Solution, Route
from ..core.eval import evaluate

class ESASolver:
    def __init__(self, 
                 problem: Problem, 
                 seed: int = 42,
                 mu: int = 100,                
                 elite_frac: float = 0.2,      
                 alpha: float = 0.95,          
                 trials_per_iter: int = 5,     
                 patience_iters: int = 100,    
                 max_generation: int = 500,   
                 evaluator: callable = None,
                 **kwargs):
        self.problem = problem
        self.seed = seed
        self.rng = random.Random(seed)
        self.mu = mu
        self.elite_frac = elite_frac
        self.alpha = alpha
        self.trials_per_iter = trials_per_iter
        self.patience_iters = patience_iters
        self.max_generation = max_generation
        self.evaluator = evaluator if evaluator is not None else evaluate

    def _init_population(self) -> List[Solution]:
        """
        Smart initialization of population:
        1. Cluster customers by nearest Depot. 
        2. Create preliminary Routes from clusters (with slight shuffling for diversity).
        3. Assign Routes to vehicles (random assignment to ensure exploration).
        """
        P = self.problem
        r = self.rng
        pop: List[Solution] = []
        
        customer_ids = [c.id for c in P.customers]
        all_vehicle_ids = [v.id for v in P.vehicles]
        veh_map = {v.id: v for v in P.vehicles}

        for _ in range(self.mu):
            # Step 1: Cluster customers by nearest Depot
            depot_to_customers = defaultdict(list)
            for cid in customer_ids:
                # Find the depot with the shortest distance to this customer
                best_depot = min(P.depots, key=lambda d: P.get_distance(d.id, cid))
                depot_to_customers[best_depot.id].append(cid)

            # Step 2: Create preliminary Routes from clusters (with slight shuffling for diversity)
            available_routes_data = []
            for d_id, c_list in depot_to_customers.items():
                if not c_list: continue
                
                # Shuffle the list of customers in the cluster
                temp_c_list = c_list[:]
                r.shuffle(temp_c_list)
                
                # Split the customer cluster into routes based on average capacity
                # (To avoid a single route being too long and causing overtime)
                avg_capacity = sum(v.max_weight for v in P.vehicles) / len(P.vehicles)
                current_route_c = []
                current_w = 0
                
                for cid in temp_c_list:
                    c_weight = sum(o.weight for o in P.nodes_map[cid].order_list)
                    if current_w + c_weight > avg_capacity and current_route_c:
                        available_routes_data.append({'d': d_id, 'c': current_route_c})
                        current_route_c = [cid]
                        current_w = c_weight
                    else:
                        current_route_c.append(cid)
                        current_w += c_weight
                
                if current_route_c:
                    available_routes_data.append({'d': d_id, 'c': current_route_c})

            # Step 3: Assign routes to vehicles (random assignment to ensure exploration)
            r.shuffle(available_routes_data)
            veh_to_routes = {v_id: [] for v_id in all_vehicle_ids}
            
            for rd_data in available_routes_data:
                route_goods = {it.type for cid in rd_data['c'] 
                               for o in P.nodes_map[cid].order_list 
                               for it in o.good_list}
                
                eligible_vehs = [v_id for v_id in all_vehicle_ids 
                                 if route_goods.issubset(veh_map[v_id].allowed_good_type)]
                
                if eligible_vehs:
                    target_v = r.choice(eligible_vehs)
                    veh_to_routes[target_v].append(rd_data)

            # Step 4: Package into Solution object
            final_routes = []
            for v_id, routes_list in veh_to_routes.items():
                for rd in routes_list:
                    seq = [rd['d']] + rd['c'] + [rd['d']]
                    final_routes.append(Route(vehicle_id=v_id, seq=seq))
            
            pop.append(Solution(routes=final_routes))

        return pop

    def _neighbor(self, sol: Solution) -> Solution:
        r = self.rng
        prob = r.random()
        
        if prob < 0.1:
            return self._neighbor_transfer_route(sol)
        
        elif prob < 0.55:
            s = copy.deepcopy(sol)
            valid_routes = [rt for rt in s.routes if len(rt.seq) > 2]
            if not valid_routes: return s
            rt_src = r.choice(valid_routes)
            rt_dst = r.choice(s.routes)
            if rt_src is not rt_dst:
                idx = r.randint(1, len(rt_src.seq) - 2)
                cid = rt_src.seq.pop(idx)
                insert_pos = r.randint(1, len(rt_dst.seq) - 1)
                rt_dst.seq.insert(insert_pos, cid)
            return s
            
        else:
            # return sol
            # pass
            s = copy.deepcopy(sol)
            valid_routes = [rt for rt in s.routes if len(rt.seq) > 2]
            if not valid_routes: return s
            rt = r.choice(valid_routes)
            i = r.randint(1, len(rt.seq) - 2)
            cid = rt.seq.pop(i)
            j = r.randint(1, len(rt.seq) - 1)
            rt.seq.insert(j, cid)
            return s
    
    def _neighbor_transfer_route(self, sol: Solution) -> Solution:
        """
        Advanced neighbor: Transfer a whole route from one vehicle to another,
        """
        r = self.rng
        s = copy.deepcopy(sol)
        
        total_customers_per_veh = defaultdict(int)
        routes_by_veh = defaultdict(list)
        
        for rt in s.routes:
            if len(rt.seq) > 2:
                cust_count = len(rt.seq) - 2
                total_customers_per_veh[rt.vehicle_id] += cust_count
                routes_by_veh[rt.vehicle_id].append(rt)
        
        eligible_v_ids = list(total_customers_per_veh.keys())
        if not eligible_v_ids:
            return s
            
        weights = [1 for vid in eligible_v_ids]
        src_v_id = r.choices(eligible_v_ids, weights=weights, k=1)[0]
        
        route_to_move = r.choice(routes_by_veh[src_v_id])
        
        all_vehicle_ids = [v.id for v in self.problem.vehicles]
        other_vehicles = [vid for vid in all_vehicle_ids if vid != src_v_id]
        
        if not other_vehicles:
            return s
            
        dest_v_id = r.choice(other_vehicles)
        dest_veh_obj = next(v for v in self.problem.vehicles if v.id == dest_v_id)
        
        route_goods = set()
        for node_id in route_to_move.seq[1:-1]:
            cust = self.problem.nodes_map.get(node_id)
            if cust:
                for o in cust.order_list:
                    for item in o.good_list:
                        route_goods.add(item.type)
        
        if not all(g in dest_veh_obj.allowed_good_type for g in route_goods):
            return s
            
        dest_existing_goods = set()
        for rt in s.routes:
            if rt.vehicle_id == dest_v_id:
                for nid in rt.seq[1:-1]:
                    c = self.problem.nodes_map.get(nid)
                    if c:
                        for o in c.order_list:
                            for it in o.good_list:
                                dest_existing_goods.add(it.type)
        
        for g_new in route_goods:
            for g_old in dest_existing_goods:
                if self.problem.are_incompatible(g_new, g_old):
                    return s 
            
        route_to_move.vehicle_id = dest_v_id
        
        return s

    def _save_final_population_details(self, population: List[Solution], filename: str):
        """Lưu chi tiết các cá thể cuối cùng."""
        import csv
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, mode='w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(["id", "cost", "distance", "vehicles", "unserved", "violations"])
            for i, sol in enumerate(population):
                cost, det = self.evaluator(self.problem, sol, return_details=True)
                writer.writerow([
                    i, cost, det['distance'], det['num_vehicles'], 
                    det['unserved_customers'], det['incompatibility_violations']
                ])

    def solve(self, time_limit_sec: float = 60.0) -> Solution:
        P = self.problem
        r = self.rng
        t0 = time.time()

        # print(f"ESA: Khởi tạo quần thể {self.mu} cá thể...")
        pop = self._init_population()
        
        def cost_of(s: Solution) -> float:
            val, _ = self.evaluator(P, s, return_details=False)
            return val

        pop.sort(key=cost_of)
        best = copy.deepcopy(pop[0])
        best_cost = cost_of(best)

        delta_f = abs(cost_of(pop[-1]) - cost_of(pop[0]))
        T = delta_f if delta_f > 0 else 1000.0
        
        patience = 0
        it = 0

        # print(f"Bắt đầu vòng lặp ESA. Best ban đầu: {best_cost:.2f}")

        while (time.time() - t0 < time_limit_sec) and (it < self.max_generation):
            it += 1
            new_pop: List[Solution] = []
            
            # 1. Giữ lại các cá thể ưu tú (Elitism)
            elite_k = max(1, int(self.elite_frac * self.mu))
            new_pop.extend(copy.deepcopy(pop[:elite_k]))

            # 2. Tạo thế hệ mới thông qua Simulated Annealing trên các Elite
            while len(new_pop) < self.mu:
                parent = r.choice(pop[:elite_k])
                child = copy.deepcopy(parent)
                
                # Biến đổi thử nghiệm
                for _ in range(self.trials_per_iter):
                    cand = self._neighbor(child)
                    dE = cost_of(cand) - cost_of(child)
                    
                    # Chấp nhận theo quy tắc Metropolis
                    if dE <= 0 or (T > 0 and r.random() < math.exp(-dE / T)):
                        child = cand
                
                new_pop.append(child)

            pop = sorted(new_pop, key=cost_of)
            cur_best_cost = cost_of(pop[0])

            if cur_best_cost < best_cost:
                best = copy.deepcopy(pop[0])
                best_cost = cur_best_cost
                patience = 0
            else:
                patience += 1

            T *= self.alpha
            
            if it % 10 == 0:
                elapsed = time.time() - t0
                print(f"Gen {it} | T: {T:.1f} | Best: {best_cost:.2f} | Time: {elapsed:.1f}s", end='\r')

            if patience >= self.patience_iters:
                print(f"\nEarly stopping at gen {it} due to no improvement.")
                break

        print(f"\nESA completed. Final Best Cost: {best_cost:.2f}")
        
        # save_path = f"last_generation/esa_final_pop_seed{self.seed}.csv"
        # self._save_final_population_details(pop, filename=save_path)
        
        return best