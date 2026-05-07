from __future__ import annotations
import random
import math
import time as _time
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Set
from collections import defaultdict

from .solver_base import Solver
from ..core.problem import Problem, Order
from ..core.solution import Solution, Route
from ..core.eval import evaluate as default_evaluator

# =========================
# 1. HELPER: K-MEANS
# =========================

def _kmeans(points: List[Tuple[float, float]], k: int, rng: random.Random, max_iter: int = 50) -> List[int]:
    n = len(points)
    if n == 0: return []
    k = max(1, min(k, n))

    centroids: List[Tuple[float, float]] = [points[rng.randrange(n)]]
    for _ in range(1, k):
        d2 = []
        for (px, py) in points:
            best = min((px - cx) ** 2 + (py - cy) ** 2 for (cx, cy) in centroids)
            d2.append(best)
        s = sum(d2) or 1.0
        r = rng.random() * s
        acc = 0.0
        pick = 0
        for i, w in enumerate(d2):
            acc += w
            if acc >= r:
                pick = i
                break
        centroids.append(points[pick])

    labels = [0] * n
    for _ in range(max_iter):
        changed = False
        for i, (px, py) in enumerate(points):
            best_c, best_d = 0, float("inf")
            for c, (cx, cy) in enumerate(centroids):
                d = (px - cx) ** 2 + (py - cy) ** 2
                if d < best_d:
                    best_d, best_c = d, c
            if labels[i] != best_c:
                labels[i] = best_c
                changed = True

        sx, sy, cnt = [0.0] * k, [0.0] * k, [0] * k
        for (px, py), c in zip(points, labels):
            sx[c] += px
            sy[c] += py
            cnt[c] += 1

        for c in range(k):
            if cnt[c] > 0:
                centroids[c] = (sx[c] / cnt[c], sy[c] / cnt[c])
            else:
                centroids[c] = points[rng.randrange(n)]
                changed = True
        if not changed: break
    return labels

# =========================
# 2. ENCODING (Customer-based)
# =========================

@dataclass
class Chromosome:
    assignment: List[int]            # Cluster to Vehicle assignment
    intra_customers: List[List[int]] # Permutation of Customers within each Cluster
    cluster_order: List[int]         # Order of processing clusters for each vehicle

# =========================
# 3. SOLVER CLASS
# =========================

class ClusterGASolver(Solver):
    def __init__(
        self,
        problem: Problem,
        seed: int = 42,
        avg_cluster_size: int = 5,
        pop_size: int = 100,
        generations: int = 500,
        cx_prob: float = 0.9,
        mut_prob: float = 0.2,
        elite_frac: float = 0.10,
        evaluator: callable = None,
        **kwargs
    ):
        super().__init__(problem, seed)
        self.rng = random.Random(seed)
        self.avg_cluster_size = max(2, avg_cluster_size)
        self.pop_size = max(10, pop_size)
        self.generations = max(1, generations)
        self.cx_prob = cx_prob
        self.mut_prob = mut_prob
        self.elite = max(1, int(self.pop_size * elite_frac))
        self.evaluator = evaluator if evaluator is not None else default_evaluator

        self.customer_ids: List[int] = [c.id for c in self.problem.customers]
        self.vehicles = list(self.problem.vehicles)
        
        # 1. K-means clustering
        self.clusters: List[List[int]] = self._build_clusters()
        
        # 2. Vehicle indices
        self.default_depot_id = self.problem.depots[0].id
        self.veh_indices = list(range(len(self.vehicles)))

    def _build_clusters(self) -> List[List[int]]:
        P = self.problem
        n = len(self.customer_ids)
        if n == 0: return []
        
        k = max(1, (n + self.avg_cluster_size - 1) // self.avg_cluster_size)
        pts = [(P.nodes_map[cid].x, P.nodes_map[cid].y) for cid in self.customer_ids]
            
        labels = _kmeans(pts, k, self.rng)
        groups = [[] for _ in range(max(labels) + 1)]
        for cid, lab in zip(self.customer_ids, labels):
            groups[lab].append(cid)
        return [g for g in groups if g]

    def _random_chromosome(self) -> Chromosome:
        P = self.problem
        assignment = []
        for group in self.clusters:
            cluster_goods = set()
            for cid in group:
                for o in P.nodes_map[cid].order_list:
                    for item in o.good_list:
                        cluster_goods.add(item.type)
            
            # Choose vehicle that can serve all goods in the cluster
            valid_vehs = [v_idx for v_idx, v in enumerate(self.vehicles) 
                          if cluster_goods.issubset(v.allowed_good_type)]
            
            if valid_vehs:
                assignment.append(self.rng.choice(valid_vehs))
            else:
                assignment.append(self.rng.choice(self.veh_indices))
        
        intra = [g[:] for g in self.clusters]
        for g in intra: self.rng.shuffle(g)
        
        c_order = list(range(len(self.clusters)))
        self.rng.shuffle(c_order)
        return Chromosome(assignment, intra, c_order)

    def _decode(self, chrom: Chromosome) -> Solution:
        """Decode: Convert customer permutations into routes."""
        P = self.problem
        cluster_queue_by_veh = [[] for _ in self.vehicles]
        priority_map = {c: i for i, c in enumerate(chrom.cluster_order)}
        
        for c_idx, v_idx in enumerate(chrom.assignment):
            cluster_queue_by_veh[v_idx].append(c_idx)
        
        for v_idx in range(len(self.vehicles)):
            cluster_queue_by_veh[v_idx].sort(key=lambda c: priority_map[c])

        final_routes: List[Route] = []
        depot_id = self.problem.depots[0].id

        for v_idx, veh in enumerate(self.vehicles):
            assigned_c_indices = cluster_queue_by_veh[v_idx]
            if not assigned_c_indices: continue
            
            current_trip_nodes = []
            curr_w, curr_v = 0.0, 0.0
            
            for c_idx in assigned_c_indices:
                for cust_id in chrom.intra_customers[c_idx]:
                    customer_node = P.nodes_map[cust_id]
                    
                    cust_w = sum(o.weight for o in customer_node.order_list)
                    cust_v = sum(o.volume for o in customer_node.order_list)
                    
                    is_compatible = True
                    for o in customer_node.order_list:
                        order_types = {it.type for it in o.good_list}
                        if not order_types.issubset(veh.allowed_good_type):
                            is_compatible = False
                            break
                    
                    if not is_compatible: continue

                    if (curr_w + cust_w > veh.max_weight or curr_v + cust_v > veh.max_volume) and current_trip_nodes:
                        final_routes.append(Route(veh.id, [depot_id] + current_trip_nodes + [depot_id]))
                        current_trip_nodes, curr_w, curr_v = [], 0.0, 0.0
                    
                    current_trip_nodes.append(cust_id)
                    curr_w += cust_w
                    curr_v += cust_v
            
            if current_trip_nodes:
                final_routes.append(Route(veh.id, [depot_id] + current_trip_nodes + [depot_id]))
                
        return Solution(final_routes)

    def _fitness(self, chrom: Chromosome) -> float:
        sol = self._decode(chrom)
        res = self.evaluator(self.problem, sol, return_details=False)
        return res[0] if isinstance(res, tuple) else float(res)

    def _cx_uniform(self, a: Chromosome, b: Chromosome) -> Tuple[Chromosome, Chromosome]:
        nC = len(self.clusters)
        ass1, ass2 = a.assignment[:], b.assignment[:]
        intra1, intra2 = [c[:] for c in a.intra_customers], [c[:] for c in b.intra_customers]
        for c in range(nC):
            if self.rng.random() < 0.5: ass1[c], ass2[c] = ass2[c], ass1[c]
            if self.rng.random() < 0.2: intra1[c], intra2[c] = intra2[c], intra1[c]
        
        ord1 = self._ox(a.cluster_order, b.cluster_order)
        ord2 = self._ox(b.cluster_order, a.cluster_order)
        return Chromosome(ass1, intra1, ord1), Chromosome(ass2, intra2, ord2)

    def _ox(self, p1: List[int], p2: List[int]) -> List[int]:
        n = len(p1)
        if n <= 1: return p1[:]
        i, j = sorted(self.rng.sample(range(n), 2))
        child = [None] * n
        child[i:j] = p1[i:j]
        fill = [x for x in p2 if x not in child[i:j]]
        k = 0
        for t in range(n):
            if child[t] is None:
                child[t] = fill[k]
                k += 1
        return child

    def _mutate(self, x: Chromosome) -> None:
        nC = len(self.clusters)
        x.assignment[self.rng.randrange(nC)] = self.rng.choice(self.veh_indices)
        c = self.rng.randrange(nC)
        if len(x.intra_customers[c]) >= 2:
            i, j = self.rng.sample(range(len(x.intra_customers[c])), 2)
            x.intra_customers[c][i], x.intra_customers[c][j] = x.intra_customers[c][j], x.intra_customers[c][i]
        if nC >= 2:
            i, j = self.rng.sample(range(nC), 2)
            x.cluster_order[i], x.cluster_order[j] = x.cluster_order[j], x.cluster_order[i]

    def solve(self, time_limit_sec: float = 300.0) -> Solution:
        pop = [self._random_chromosome() for _ in range(self.pop_size)]
        
        def get_fit(ch):
            return self._fitness(ch)

        pop.sort(key=get_fit)
        best = pop[0]
        best_cost = get_fit(best)
        t0 = _time.time()
        
        gen = 0
        while (_time.time() - t0) < time_limit_sec and gen < self.generations:
            new_pop = pop[:self.elite]
            
            while len(new_pop) < self.pop_size:
                p1_sample = self.rng.sample(pop, 2)
                p2_sample = self.rng.sample(pop, 2)
                parent1 = min(p1_sample, key=get_fit)
                parent2 = min(p2_sample, key=get_fit)
                
                if self.rng.random() < self.cx_prob:
                    c1, c2 = self._cx_uniform(parent1, parent2)
                else:
                    c1, c2 = Chromosome(parent1.assignment[:], [cl[:] for cl in parent1.intra_customers], parent1.cluster_order[:]), \
                             Chromosome(parent2.assignment[:], [cl[:] for cl in parent2.intra_customers], parent2.cluster_order[:])
                
                if self.rng.random() < self.mut_prob: self._mutate(c1)
                if self.rng.random() < self.mut_prob: self._mutate(c2)
                
                new_pop.extend([c1, c2])
            
            pop = new_pop[:self.pop_size]
            pop.sort(key=get_fit)
            
            if get_fit(pop[0]) < best_cost:
                best = pop[0]
                best_cost = get_fit(best)
                print(f"Gen {gen}: New Best Cost = {best_cost:.2f}")
            
            if gen % 10 == 0:
                print(f"Generation {gen}, Best Cost: {best_cost:.2f}", end="\r")
            gen += 1
            
        return self._decode(best)