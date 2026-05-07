import csv
import os
from typing import List, Dict, Set, Tuple
from vrp.core.problem import (
    Vehicle, Depot, GoodsItem, Order, Customer, Problem,
    ORDER_TYPE_PICKUP, ORDER_TYPE_DELIVERY
)

CUSTOMER_ID_OFFSET = 10000 
GAS_PRICE = 30000 

def read_csv(data_dir: str, filename: str) -> List[Dict]:
    path = os.path.join(data_dir, filename)
    if not os.path.exists(path):
        return []
    with open(path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        return [{k.strip(): v for k, v in row.items() if k is not None} for row in reader]

def load_problem(data_dir: str) -> Problem:
    print(">>> Bắt đầu load dữ liệu và lọc khách hàng không hợp lệ...")

    # Step 1: Load Vehicles
    veh_prod_map = {}
    for row in read_csv(data_dir, 'vehicles_products.csv'):
        vid = int(row['vehicle_id'])
        pid = int(row['product_id'])
        veh_prod_map.setdefault(vid, []).append(pid)

    vehicles = []
    for row in read_csv(data_dir, 'vehicles.csv'):
        vid = int(row['id'])
        avg_fee = float(row.get('average_fee_transport', 0))
        avg_gas = float(row.get('average_gas_consume', 0))
        oc = avg_fee + (avg_gas * GAS_PRICE)
        fixed_cost = float(row.get('fixed_cost', 0))
        tc = fixed_cost / 60 

        vehicles.append(Vehicle(
            id=vid,
            type=row.get('type', 'TRUCK'),
            operating_time=8 * 60 * 60, 
            max_travel_distance=int(row.get('max_travel_distance', 120000)),
            max_weight=float(row.get('max_load_weight', 0)),
            max_volume=float(row.get('max_capacity', 0)),
            allowed_good_type=set(veh_prod_map.get(vid, list(range(1, 200)))), 
            operating_cost=oc,
            time_based_cost=tc
        ))

    # Step 2: Load Incompatible Pairs
    incompat = set()
    for row in read_csv(data_dir, 'product_exclude.csv'):
        p1 = int(row['product_excluding_id'])
        p2 = int(row['excluded_product_id'])
        incompat.add((p1, p2))
        incompat.add((p2, p1))

    # Step 3: Load Goods & Orders
    order_items_map = {}
    for row in read_csv(data_dir, 'order_items.csv'):
        oid = int(row['order_id'])
        item = GoodsItem(
            id=int(row['id']),
            type=int(row['product_id']),
            quantity=int(row['quantity']),
            weight=float(row['weight']),
            volume=float(row['capacity'])
        )
        order_items_map.setdefault(oid, []).append(item)

    customer_orders_map = {}
    for row in read_csv(data_dir, 'orders.csv'):
        oid = int(row['id'])
        cid = int(row['customer_id']) + CUSTOMER_ID_OFFSET
        goods = order_items_map.get(oid, [])
        ts = float(row.get('time_service', 0))
        tl = float(row.get('time_loading', 0))
        
        order = Order(
            id=oid,
            type=ORDER_TYPE_DELIVERY,
            good_list=goods,
            weight=float(row['weight']),
            volume=float(row['capacity']),
            customer_id=cid,
            service_duration=ts + tl
        )
        customer_orders_map.setdefault(cid, []).append(order)

    # Step 4: Load & Filter Customers
    customers = []
    dropped_internal_conflict = 0
    dropped_no_vehicle = 0
    dropped_capacity = 0

    max_fleet_weight = max((v.max_weight for v in vehicles), default=0)
    max_fleet_volume = max((v.max_volume for v in vehicles), default=0)

    for row in read_csv(data_dir, 'customers.csv'):
        cid = int(row['id']) + CUSTOMER_ID_OFFSET
        c_orders = customer_orders_map.get(cid, [])
        
        if not c_orders: continue

        c_goods_types = set()
        total_w = 0
        total_v = 0
        for o in c_orders:
            total_w += o.weight
            total_v += o.volume
            for item in o.good_list:
                c_goods_types.add(item.type)

        # Filter 1: Check capacity against max fleet capacity
        if total_w > max_fleet_weight or total_v > max_fleet_volume:
            dropped_capacity += 1
            # print(f"DROP Customer {cid}: Over capacity (W={total_w}, V={total_v})")
            continue

        # Filter 2: Check internal incompatibility
        internal_conflict = False
        c_goods_list = list(c_goods_types)
        for i in range(len(c_goods_list)):
            for j in range(i + 1, len(c_goods_list)):
                if (c_goods_list[i], c_goods_list[j]) in incompat:
                    internal_conflict = True; break
            if internal_conflict: break
        
        if internal_conflict:
            dropped_internal_conflict += 1
            print(f"DROP Customer {cid}: Internal Conflict goods {c_goods_list}")
            continue

        # Filter 3: Check if any vehicle can serve this customer (Allowed Goods)
        can_be_served = False
        for v in vehicles:
            if c_goods_types.issubset(v.allowed_good_type):
                can_be_served = True
                break
        
        if not can_be_served:
            dropped_no_vehicle += 1
            # print(f"DROP Customer {cid}: No compatible vehicle for goods {c_goods_types}")
            continue

        customers.append(Customer(
            id=cid,
            x=float(row['latitude']),
            y=float(row['longitude']),
            start_time=float(row['start_time']),
            end_time=float(row['end_time']),
            order_list=c_orders
        ))

    print(f"--- Thống kê lọc dữ liệu ---")
    print(f"Dropped (Internal Conflict): {dropped_internal_conflict}")
    print(f"Dropped (No Vehicle Fit):    {dropped_no_vehicle}")
    print(f"Dropped (Over Capacity):     {dropped_capacity}")
    print(f"Final Valid Customers:       {len(customers)}")

    # Step 5: Load Depots
    depots = []
    for row in read_csv(data_dir, 'depots.csv'):
        depots.append(Depot(
            id=int(row['id']),
            x=float(row['latitude']),
            y=float(row['longitude']),
            start_time=float(row['start_time']),
            end_time=float(row['end_time'])
        ))

    # Step 6: Load Matrices
    dist_mtx, time_mtx = {}, {}
    for row in read_csv(data_dir, 'correlations.csv'):
        u_id = int(row['from_node_id'])
        v_id = int(row['to_node_id'])
        
        if row['from_node_type'] == 'CUSTOMER': u_id += CUSTOMER_ID_OFFSET
        if row['to_node_type'] == 'CUSTOMER': v_id += CUSTOMER_ID_OFFSET
        
        dist_mtx[(u_id, v_id)] = float(row['distance'])
        time_mtx[(u_id, v_id)] = float(row['time'])

    return Problem(
        vehicles=vehicles,
        depots=depots,
        customers=customers,
        penalty_weight=25,
        distance_matrix=dist_mtx,
        time_matrix=time_mtx,
        incompatible_goods_pairs=incompat,
        big_M=1e9
    )

if __name__ == "__main__":
    DATA_DIR = './data_processed'
    problem = load_problem(DATA_DIR)
    
    print(f"Problem Loaded Successfully:")
    print(f"- Total Vehicles: {len(problem.vehicles)}")
    print(f"- Total Depots: {len(problem.depots)}")
    print(f"- Total Customers: {len(problem.customers)}")
    print(f"- Total Orders: {len(problem.orders)}")
    print(f"- Incompatible Pairs: {len(problem.incompatible_pairs)}")