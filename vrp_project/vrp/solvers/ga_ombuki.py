import random
import copy
import numpy as np
from typing import List, Tuple, Dict
from collections import defaultdict

from ..core.problem import Problem
from ..core.solution import Solution, Route
from ..core.eval import evaluate

class OmbukiGASolver:
    def __init__(self, problem: Problem, seed: int = 42, evaluator=evaluate, **kwargs):
        self.prob = problem
        self.evaluator = evaluator
        self.seed = seed
        random.seed(seed)
        np.random.seed(seed)

        self.pop_size = kwargs.get("pop_size", 100)
        self.n_generations = kwargs.get("n_generations", 500)
        self.p_crossover = kwargs.get("p_crossover", 0.80)
        self.p_mutation = kwargs.get("p_mutation", 0.10)
        self.tournament_size = 4

    def _routing_scheme(self, chromosome: List[int]) -> Solution:
        """
        Cut routes based on vehicle capacities and constraints.
        """
        P = self.prob
        final_solution_routes = []
        
        # Sort vehicles by max weight capacity descending
        available_vehicles = sorted(P.vehicles, key=lambda v: v.max_weight, reverse=True)
        v_idx = 0
        
        unassigned_customers = chromosome[:]
        
        # Continue routing until all customers are assigned or no more vehicles
        while unassigned_customers and v_idx < len(available_vehicles):
            vehicle = available_vehicles[v_idx]
            depot_id = P.depots[0].id
            
            current_route_seq = [depot_id]
            current_w = 0.0
            current_v = 0.0
            # Actual time (including waiting and service)
            current_time = P.nodes_map[depot_id].start_time
            current_dist = 0.0
            
            idx = 0
            while idx < len(unassigned_customers):
                cid = unassigned_customers[idx]
                cust = P.nodes_map[cid]
                
                # 1. Order weight and volume
                c_w = sum(o.weight for o in cust.order_list)
                c_v = sum(o.volume for o in cust.order_list)
                
                # 2. Distance and Time calculations
                prev_node_id = current_route_seq[-1]
                travel_time = P.get_time(prev_node_id, cid)
                travel_dist = P.get_distance(prev_node_id, cid)
                
                # Calculate time: If arriving early, wait until start_time 
                arrival_time = max(current_time + travel_time, cust.start_time)
                service_finish_time = arrival_time + sum(o.service_duration for o in cust.order_list)
                
                # Calculate return trip to Depot to check Operating Time
                return_time = P.get_time(cid, depot_id)
                return_dist = P.get_distance(cid, depot_id)
                
                total_op_time = (service_finish_time + return_time) - P.nodes_map[depot_id].start_time
                total_op_dist = current_dist + travel_dist + return_dist

                # CHECK HARD CONSTRAINTS (Skip checking Time Window b_i)
                is_feasible = (
                    current_w + c_w <= vehicle.max_weight and
                    current_v + c_v <= vehicle.max_volume and
                    total_op_time <= vehicle.operating_time and
                    total_op_dist <= vehicle.max_travel_distance
                )

                if is_feasible:
                    current_route_seq.append(cid)
                    current_w += c_w
                    current_v += c_v
                    current_time = service_finish_time
                    current_dist += travel_dist
                    unassigned_customers.pop(idx) 
                else:
                    # Vi phạm các giới hạn vật lý của xe -> Cắt route chuyển xe khác
                    
                    # print(f"Vehicle {vehicle.id} capacity exceeded at customer {cid}. " 
                    #     f"Weight: {current_w + c_w}/{vehicle.max_weight}, "
                    #     f"Volume: {current_v + c_v}/{vehicle.max_volume}, "
                    #     f"Operating Time: {total_op_time}/{vehicle.operating_time}, "
                    #     f"Distance: {total_op_dist}/{vehicle.max_travel_distance}")
                    break
            
            # End of route, return to depot
            current_route_seq.append(depot_id)
            if len(current_route_seq) > 2:
                final_solution_routes.append(Route(vehicle_id=vehicle.id, seq=current_route_seq))
            # Move to next vehicle
            v_idx += 1

        return Solution(routes=final_solution_routes)

    def _create_greedy_chromosome(self) -> List[int]:
        """
        Greedy chromosome initialization (Nearest Neighbor).
        """
        P = self.prob
        unvisited = [c.id for c in P.customers]
        
        current_node_id = random.choice(unvisited)
        chromosome = [current_node_id]
        unvisited.remove(current_node_id)
        
        while unvisited:
            next_node_id = min(unvisited, key=lambda cid: P.get_distance(current_node_id, cid))
            
            chromosome.append(next_node_id)
            unvisited.remove(next_node_id)
            current_node_id = next_node_id
            
        return chromosome
    
    def _pareto_ranking(self, population: List[Solution]) -> List[int]:
        """
        Pareto ranking based on two objectives: number of vehicles and total distance.
        """
        pop_size = len(population)
        costs = []
        for sol in population:
            obj, det = self.evaluator(self.prob, sol)
            costs.append((det['num_vehicles'], det['distance']))

        ranks = [0] * pop_size
        current_rank = 1
        remaining_indices = list(range(pop_size))

        while remaining_indices:
            nondominated = []
            for i in remaining_indices:
                is_dominated = False
                for j in remaining_indices:
                    if i == j: continue
                    # Kiểm tra lấn át (u lấn át v) [cite: 963, 966]
                    if (costs[j][0] <= costs[i][0] and costs[j][1] <= costs[i][1]) and \
                       (costs[j][0] < costs[i][0] or costs[j][1] < costs[i][1]):
                        is_dominated = True
                        break
                if not is_dominated:
                    nondominated.append(i)
            
            for idx in nondominated:
                ranks[idx] = current_rank
                remaining_indices.remove(idx)
            current_rank += 1
            
        return ranks

    def _best_cost_route_crossover(self, p1_sol: Solution, p2_sol: Solution) -> List[int]:
        """
        BCRC operator (Best Cost Route Crossover).
        """
        # Flatten solutions to chromosomes
        def get_chromo(sol):
            return [node for r in sol.routes for node in r.seq[1:-1]]

        c1_chromo = get_chromo(p1_sol)
        c2_chromo = get_chromo(p2_sol)
        
        # Choose random route from p1_sol
        r1 = random.choice(p1_sol.routes)
        nodes_to_remove = r1.seq[1:-1]
        
        # Remove these nodes from c2_chromo
        new_c2 = [n for n in c2_chromo if n not in nodes_to_remove]
        
        # Insert each node back at the position with the lowest cost (Simplified BCRC)
        for node in nodes_to_remove:
            best_pos = random.randint(0, len(new_c2))
            new_c2.insert(best_pos, node)
            
        return new_c2

    def _mutation(self, chromosome: List[int]) -> List[int]:
        """
        Mutation operator: Inversion mutation
        """
        if len(chromosome) < 3: return chromosome
        new_chromo = chromosome[:]
        length = random.randint(2, 3)
        start = random.randint(0, len(new_chromo) - length)
        new_chromo[start:start+length] = reversed(new_chromo[start:start+length])
        return new_chromo

    def solve(self, time_limit_sec: float = 60.0) -> Solution:
        customer_ids = [c.id for c in self.prob.customers]
        population_chromos = []
        n_greedy = max(1, self.pop_size // 2)
        
        for _ in range(n_greedy):
            population_chromos.append(self._create_greedy_chromosome())
            
        for _ in range(self.pop_size - n_greedy):
            chromo = customer_ids[:]
            random.shuffle(chromo)
            population_chromos.append(chromo)

        best_sol = None
        best_cost = float('inf')

        for gen in range(self.n_generations):
            solutions = [self._routing_scheme(c) for c in population_chromos]
            
            ranks = self._pareto_ranking(solutions)
            
            for i, sol in enumerate(solutions):
                cost, _ = self.evaluator(self.prob, sol)
                if cost < best_cost:
                    best_cost = cost
                    best_sol = copy.deepcopy(sol)

            new_chromos = []
            rank_indices = np.argsort(ranks)
            for i in range(max(1, self.pop_size // 10)):
                new_chromos.append(population_chromos[rank_indices[i]])

            while len(new_chromos) < self.pop_size:
                p1_idx = self._tournament(ranks)
                p2_idx = self._tournament(ranks)
                
                if random.random() < self.p_crossover:
                    offspring = self._best_cost_route_crossover(solutions[p1_idx], solutions[p2_idx])
                else:
                    offspring = population_chromos[p1_idx][:]
                
                if random.random() < self.p_mutation:
                    offspring = self._mutation(offspring)
                
                new_chromos.append(offspring)
            
            population_chromos = new_chromos
            if gen % 10 == 0:
                print(f"Generation {gen} | Best Cost: {best_cost:.2f}")

        return best_sol

    def _tournament(self, ranks: List[int]) -> int:
        """Tournament selection based on Pareto Rank (lower rank is better)[cite: 952, 1096]."""
        candidates = random.sample(range(len(ranks)), self.tournament_size)
        return min(candidates, key=lambda i: ranks[i])