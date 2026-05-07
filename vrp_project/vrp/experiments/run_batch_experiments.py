# vrp/experiments/run_batch_experiments.py
# How to run:
# python -m vrp.experiments.run_batch_experiments --data_dir ./data --datasets ds1 ds2 --solvers all --evaluators all --output results.csv --start_seed 42 --num_seeds 5 --time_limit 60

import csv
import json
import time
import os
import argparse
import sys
from pathlib import Path

from ..data.loader import load_problem
from ..solvers.esa import ESASolver
from ..solvers.ga_tcpvrp import GA_TCPVRP_Solver
from ..solvers.ga_ombuki import OmbukiGASolver
from ..solvers.dfa import DFASolver
from ..solvers.cluster_ga import ClusterGASolver
from ..core.eval import evaluate
from ..core.eval_hard_tw import evaluate_hard_tw

AVAILABLE_SOLVERS = {
    "esa": ESASolver,
    "ga_tcpvrp": GA_TCPVRP_Solver,
    "ga_ombuki": OmbukiGASolver,
    "dfa": DFASolver,
    "cluster_ga": ClusterGASolver,
}

AVAILABLE_EVALUATORS = {
    "origin": evaluate,
    "hard_tw": evaluate_hard_tw
}

def serialize_solution(solution):
    """Serialize solution to JSON string to store in CSV."""
    routes_data = []
    if not solution or not hasattr(solution, 'routes'):
        return json.dumps([])
        
    for r in solution.routes:
        if len(r.seq) > 2:
            routes_data.append({
                "vehicle_id": r.vehicle_id,
                "sequence": r.seq
            })
    return json.dumps(routes_data)

def main():
    parser = argparse.ArgumentParser(description="Chạy thực nghiệm Batch VRP")
    parser.add_argument("--data_dir", type=str, required=True, 
                        help="Đường dẫn thư mục CHA chứa các thư mục dataset")
    
    parser.add_argument("--datasets", nargs="+", default=["ds1", "ds2", "ds3", "ds4", "ds5", "ds6"],
                        help="Danh sách tên các folder con dataset (VD: ds1 ds2 ds3...)")
    
    parser.add_argument("--solvers", nargs="+", choices=list(AVAILABLE_SOLVERS.keys()) + ['all'], default=['all'],
                        help="Chọn thuật toán để chạy (esa, ga_tcpvrp, ga_ombuki, dfa). Chọn 'all' để chạy hết.")
    
    parser.add_argument("--evaluators", nargs="+", choices=list(AVAILABLE_EVALUATORS.keys()) + ['all'], default=['all'],
                        help="Chọn hàm đánh giá (origin, hard_tw). Chọn 'all' để chạy hết.")
    
    parser.add_argument("--output", type=str, default="experiment_results.csv",
                        help="Tên file CSV kết quả đầu ra")
    
    parser.add_argument("--start_seed", type=int, default=42, help="Seed bắt đầu")
    parser.add_argument("--num_seeds", type=int, default=10, help="Số lượng seed muốn chạy (VD: 10 seed tính từ start_seed)")
    
    parser.add_argument("--time_limit", type=float, default=60.0, help="Thời gian giới hạn cho mỗi lần chạy (giây)")
    args = parser.parse_args()


    target_solvers = AVAILABLE_SOLVERS if 'all' in args.solvers else {k: v for k, v in AVAILABLE_SOLVERS.items() if k in args.solvers}
    target_evaluators = AVAILABLE_EVALUATORS if 'all' in args.evaluators else {k: v for k, v in AVAILABLE_EVALUATORS.items() if k in args.evaluators}
    target_seeds = range(args.start_seed, args.start_seed + args.num_seeds)

    fieldnames = [
        "dataset", "solver", "evaluator_type", "seed", 
        "time_limit", "execution_time",
        "objective_cost", "total_cost", 
        "oc", "tc", "pc", 
        "num_vehicles", "distance",
        "unserved_customers", 
        "capacity_violations", "volume_violations", 
        "incompatibility_violations", "overtime_violations", "overdistance_violations",
        "solution_json"
    ]

    file_exists = os.path.isfile(args.output)
    
    total_runs = len(args.datasets) * len(target_solvers) * len(target_evaluators) * len(target_seeds)
    current_run = 0

    print(f"{'='*60}")
    print(f"EXPERIMENT SETTINGS")
    print(f"- Data Directory: {os.path.abspath(args.data_dir)}")
    print(f"- Datasets:       {args.datasets}")
    print(f"- Solvers:        {list(target_solvers.keys())}")
    print(f"- Evaluators:     {list(target_evaluators.keys())}")
    print(f"- Seeds:          {args.num_seeds} seeds (từ {args.start_seed})")
    print(f"- Time Limit:     {args.time_limit}s")
    print(f"- Output File:    {os.path.abspath(args.output)}")
    print(f"{'='*60}\n")

    with open(args.output, mode='a', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()

        for ds_name in args.datasets:
            ds_path = os.path.join(args.data_dir, ds_name)
            
            if not os.path.exists(ds_path):
                print(f"[SKIP] Dataset folder not found: {ds_path}")
                current_run += len(target_solvers) * len(target_evaluators) * len(target_seeds)
                continue

            print(f">>> Loading dataset: {ds_path} ...")
            try:
                prob = load_problem(ds_path)
            except Exception as e:
                print(f"[ERR] Error loading dataset {ds_name}: {e}")
                current_run += len(target_solvers) * len(target_evaluators) * len(target_seeds)
                continue

            for solver_name, SolverCls in target_solvers.items():
                for eval_name, eval_func in target_evaluators.items():
                    for seed in target_seeds:
                        current_run += 1
                        print(f"[{current_run}/{total_runs}] {ds_name} | {solver_name} | {eval_name} | Seed {seed}", end=" ... ")
                        sys.stdout.flush()

                        try:
                            solver = SolverCls(
                                problem=prob, 
                                seed=seed, 
                                evaluator=eval_func
                            )

                            t0 = time.time()
                            sol = solver.solve(time_limit_sec=args.time_limit)
                            exec_time = time.time() - t0

                            obj_cost, det = eval_func(prob, sol, return_details=True)

                            row = {
                                "dataset": ds_name,
                                "solver": solver_name,
                                "evaluator_type": eval_name,
                                "seed": seed,
                                "time_limit": args.time_limit,
                                "execution_time": round(exec_time, 4),
                                "objective_cost": obj_cost,
                                "total_cost": det.get("total_cost", 0),
                                "oc": det.get("oc", 0),
                                "tc": det.get("tc", 0),
                                "pc": det.get("pc", 0),
                                "num_vehicles": det.get("num_vehicles", 0),
                                "distance": det.get("distance", 0),
                                "unserved_customers": det.get("unserved_customers", 0),
                                "capacity_violations": det.get("capacity_violations", 0),
                                "volume_violations": det.get("volume_violations", 0),
                                "incompatibility_violations": det.get("incompatibility_violations", 0),
                                "overtime_violations": det.get("overtime_violations", 0),
                                "overdistance_violations": det.get("overdistance_violations", 0),
                                "solution_json": serialize_solution(sol)
                            }
                            
                            writer.writerow(row)
                            csvfile.flush()
                            print(f"OK (Cost: {obj_cost:.2f})")

                        except Exception as e:
                            print(f"FAILED: {str(e)}")
                            error_row = {
                                "dataset": ds_name, "solver": solver_name, 
                                "evaluator_type": eval_name, "seed": seed,
                                "solution_json": f"ERROR: {str(e)}"
                            }
                            writer.writerow(error_row)
                            csvfile.flush()

    print("\n=== EXPERIMENT COMPLETED ===")

if __name__ == "__main__":
    main()