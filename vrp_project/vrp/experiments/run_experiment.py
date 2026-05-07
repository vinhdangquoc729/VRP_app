# vrp/experiments/run_experiment.py
import argparse
import time
from pathlib import Path
import yaml

from ..data.loader import load_problem
from ..solvers.esa import ESASolver
from ..solvers.ga_tcpvrp import GA_TCPVRP_Solver
from ..solvers.ga_ombuki import OmbukiGASolver
from ..solvers.dfa import DFASolver
from ..solvers.cluster_ga import ClusterGASolver
from ..core.eval import evaluate
from ..core.eval_hard_tw import evaluate_hard_tw

SOLVERS = {
    "esa": ESASolver,
    "ga_tcpvrp": GA_TCPVRP_Solver,
    "ga_ombuki": OmbukiGASolver,
    "dfa": DFASolver,
    "cluster_ga": ClusterGASolver,
}
EVALUATORS = {
    "origin": evaluate,
    "hard_tw": evaluate_hard_tw
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Đường dẫn thư mục chứa các file csv (nodes, vehicles...)")
    ap.add_argument("--solver", choices=SOLVERS.keys(), default="esa")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--time", type=float, default=60.0, help="Giới hạn thời gian chạy (giây)")
    ap.add_argument("--config", type=str, default=None, help="File YAML chứa tham số solver (mu, alpha,...)")
    ap.add_argument("--plot", action="store_true", help="Vẽ hình minh họa lộ trình")
    ap.add_argument("--plot_path", type=str, default=None, help="Đường dẫn lưu ảnh PNG")
    ap.add_argument("--annotate", action="store_true", help="Hiển thị ID khách hàng trên hình")
    ap.add_argument("--evaluator", default="origin", choices=EVALUATORS.keys())
    
    args = ap.parse_args()

    # 1. Load Problem 
    print(f"--- Loading data from: {args.data} ---")
    prob = load_problem(args.data)

    # 2. Solver Config
    cfg = {}
    if args.config:
        cfg = yaml.safe_load(Path(args.config).read_text()) or {}

    # 3. Solver Initialization
    SolverCls = SOLVERS[args.solver]
    evaluator = EVALUATORS[args.evaluator]
    solver = SolverCls(
        problem=prob, 
        seed=args.seed, 
        evaluator=evaluator, 
        **cfg
    )

    print(evaluator)
    # 4. Loading algorithm and solving
    print(f"--- Running {args.solver.upper()} (Seed: {args.seed}, Time: {args.time}s) ---")
    t0 = time.time()
    sol = solver.solve(time_limit_sec=args.time)
    elapsed = time.time() - t0

    # 5. Evaluate solution
    obj_cost, det = evaluator(prob, sol, return_details=True)

    print("\n" + "="*50)
    print(f"KẾT QUẢ THỬ NGHIỆM")
    print("="*50)
    print(f"Thư mục dữ liệu: {Path(args.data).resolve()}")
    print(f"Thuật toán:     {args.solver}")
    print(f"Thời gian chạy:  {round(elapsed, 3)} s")
    print(f"Objective Cost: {obj_cost}")
    print("-" * 20)
    print(f"Chi tiết chi phí:")
    print(f"  - OC (Vận hành): {det['oc']}")
    print(f"  - TC (Thời gian): {det['tc']}")
    print(f"  - PC (Phạt TW):   {det['pc']}")
    print(f"  - Số xe sử dụng:  {det['num_vehicles']}")
    print("-" * 20)
    print(f"Vi phạm ràng buộc:")
    print(f"  - Tải trọng:      {det['capacity_violations']}")
    print(f"  - Thể tích:       {det['volume_violations']}")
    print(f"  - Hàng kỵ nhau:   {det['incompatibility_violations']}")
    print(f"  - Quá giờ:        {det['overtime_violations']}")
    print(f"  - Đơn hàng sót:   {det['unserved_customers']}")
    print("="*50)

    # 7. Vẽ hình nếu có yêu cầu
    if args.plot:
        pass
        out = args.plot_path or str(Path(args.data) / f"solution_{args.solver}_seed{args.seed}.png")
        # draw_solution(prob, sol, save_path=out, show=False, annotate=args.annotate)
        print(f"Đã lưu hình ảnh lộ trình tại: {out}")

if __name__ == "__main__":
    main()