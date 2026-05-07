import matplotlib.pyplot as plt
from ..core.problem import Problem

def plot_nodes(problem: Problem, save_path: str = None, show: bool = True):
    """
    Vẽ sơ đồ phân bố các điểm Depot và Customer trên hệ tọa độ.
    """
    depot_x, depot_y = [], []
    customer_x, customer_y = [], []
    
    # 1. Tách dữ liệu Node dựa trên thuộc tính is_depot
    for node in problem.nodes_map.values():
        if node.is_depot:
            depot_x.append(node.x)
            depot_y.append(node.y)
        else:
            customer_x.append(node.x)
            customer_y.append(node.y)

    plt.figure(figsize=(12, 8))
    
    # 2. Vẽ các điểm khách hàng (Màu xanh, kích thước nhỏ)
    plt.scatter(customer_x, customer_y, c='blue', s=20, label='Customer', alpha=0.6, marker='o')
    
    # 3. Vẽ các điểm kho (Màu đỏ, kích thước lớn, hình vuông)
    plt.scatter(depot_x, depot_y, c='red', s=150, label='Depot', alpha=0.9, marker='s', edgecolors='black')

    # 4. Trang trí biểu đồ
    plt.title(f"VRP Node Distribution (Nodes: {len(problem.nodes_map)})", fontsize=15)
    plt.xlabel("Longitude (X)", fontsize=12)
    plt.ylabel("Latitude (Y)", fontsize=12)
    plt.grid(True, linestyle='--', alpha=0.5)
    plt.legend(loc='upper right')

    # Lưu file nếu có yêu cầu
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        print(f"✅ Đã lưu bản đồ các điểm tại: {save_path}")

    if show:
        plt.show()
    else:
        plt.close()

# Ví dụ sử dụng trong main.py hoặc run_experiment.py
if __name__ == "__main__":
    from ..data.loader import load_problem
    prob = load_problem('data_processed')
    plot_nodes(prob, save_path='node_distribution.png')