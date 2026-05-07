import pandas as pd
import os
import shutil

# Cấu hình
SOURCE_DIR = './data_processed'
CUSTOMER_ID_OFFSET = 10000

def get_clean_customers_and_orders(customers_df, orders_df, items_df, exclude_df, vehicles_df, veh_prod_df):
    """Lọc danh sách khách hàng và đơn hàng hợp lệ"""
    print("Đang phân tích tính hợp lệ của dữ liệu gốc...")
    
    # 1. Map luật kỵ nhau
    incompat = set()
    for _, row in exclude_df.iterrows():
        p1, p2 = int(row['product_excluding_id']), int(row['excluded_product_id'])
        incompat.add(tuple(sorted((p1, p2))))

    # 2. Map hàng hóa của từng đơn
    order_to_goods = items_df.groupby('order_id')['product_id'].apply(set).to_dict()
    
    # 3. Map xe chở được gì
    veh_allowed = veh_prod_df.groupby('vehicle_id')['product_id'].apply(set).to_dict()
    all_vehs_allowed = [veh_allowed.get(vid, set(range(1, 200))) for vid in vehicles_df['id']]
    
    max_fleet_w = vehicles_df['max_load_weight'].max()
    max_fleet_v = vehicles_df['max_capacity'].max()

    valid_customers = []
    valid_orders_list = []

    for _, c_row in customers_df.iterrows():
        cid = c_row['id']
        c_orders = orders_df[orders_df['customer_id'] == cid]
        if c_orders.empty: continue

        # Lọc các đơn hàng "sạch" của khách này
        clean_c_orders = []
        c_goods_accumulator = set()
        total_w, total_v = 0, 0
        
        for _, o_row in c_orders.iterrows():
            oid = o_row['id']
            o_goods = order_to_goods.get(oid, set())
            
            # Check kỵ hàng nội bộ
            temp_goods = c_goods_accumulator | o_goods
            goods_list = list(temp_goods)
            has_conflict = False
            for i in range(len(goods_list)):
                for j in range(i + 1, len(goods_list)):
                    if tuple(sorted((goods_list[i], goods_list[j]))) in incompat:
                        has_conflict = True; break
                if has_conflict: break
            
            # Check xe chở được không
            can_be_served = any(temp_goods.issubset(allowed) for allowed in all_vehs_allowed)

            if not has_conflict and can_be_served:
                if total_w + o_row['weight'] <= max_fleet_w and total_v + o_row['capacity'] <= max_fleet_v:
                    clean_c_orders.append(o_row)
                    c_goods_accumulator.update(o_goods)
                    total_w += o_row['weight']
                    total_v += o_row['capacity']

        if clean_c_orders:
            valid_customers.append(c_row)
            valid_orders_list.extend(clean_c_orders)

    return pd.DataFrame(valid_customers), pd.DataFrame(valid_orders_list)

def create_datasets():
    # Load gốc
    customers_all = pd.read_csv(os.path.join(SOURCE_DIR, 'customers.csv'))
    orders_all = pd.read_csv(os.path.join(SOURCE_DIR, 'orders.csv'))
    order_items_all = pd.read_csv(os.path.join(SOURCE_DIR, 'order_items.csv'))
    correlations_all = pd.read_csv(os.path.join(SOURCE_DIR, 'correlations.csv'))
    vehicles_all = pd.read_csv(os.path.join(SOURCE_DIR, 'vehicles.csv'))
    veh_prod_all = pd.read_csv(os.path.join(SOURCE_DIR, 'vehicles_products.csv'))
    exclude_all = pd.read_csv(os.path.join(SOURCE_DIR, 'product_exclude.csv'))
    depots_all = pd.read_csv(os.path.join(SOURCE_DIR, 'depots.csv'))

    # Lọc pool sạch
    clean_customers_pool, clean_orders_pool = get_clean_customers_and_orders(
        customers_all, orders_all, order_items_all, exclude_all, vehicles_all, veh_prod_all
    )

    configs = [
        {'name': 'DS4', 'C': 304, 'O': 354, 'V': 20},
        {'name': 'DS5', 'C': 108, 'O': 153, 'V': 8},
        {'name': 'DS6', 'C': 108, 'O': 178, 'V': 9}
    ]

    for cfg in configs:
        print(f"--- Tạo bộ {cfg['name']} ---")
        path = cfg['name']
        os.makedirs(path, exist_ok=True)

        # 1. Chọn Xe
        v_8ton = vehicles_all[vehicles_all['id'] == 8]
        v_bikes = vehicles_all[vehicles_all['type'] == 'BIKE']
        v_others = vehicles_all[(vehicles_all['id'] != 8) & (vehicles_all['type'] != 'BIKE')]
        pd.concat([v_8ton, v_bikes.sample(n=1), v_others.sample(n=cfg['V']-2)]).to_csv(os.path.join(path, 'vehicles.csv'), index=False)
        v_ids = pd.read_csv(os.path.join(path, 'vehicles.csv'))['id'].unique()
        veh_prod_all[veh_prod_all['vehicle_id'].isin(v_ids)].to_csv(os.path.join(path, 'vehicles_products.csv'), index=False)

        # 2. Lấy mẫu Khách và Đơn
        if cfg['name'] == 'DS4' or cfg['name'] == 'DS5' or cfg['name'] == 'DS6':
            # Đếm đơn hàng mỗi khách có trong pool sạch
            order_counts = clean_orders_pool.groupby('customer_id').size().reset_index(name='count')
            
            # Sắp xếp khách hàng theo số lượng đơn giảm dần để tối đa hóa pool đơn hàng dư
            all_candidates = order_counts.sort_values(by='count', ascending=False)
            
            # Lấy 200 khách hàng đứng đầu (có nhiều đơn nhất)
            selected_c_ids = all_candidates.head(cfg['C'])['customer_id'].tolist()
            
            selected_customers = clean_customers_pool[clean_customers_pool['id'].isin(selected_c_ids)]
            all_orders_of_selected = clean_orders_pool[clean_orders_pool['customer_id'].isin(selected_c_ids)]
            
            # Đảm bảo mỗi khách có ít nhất 1 đơn
            base_orders = all_orders_of_selected.groupby('customer_id').head(1)
            remaining_needed = cfg['O'] - len(base_orders)
            
            # Pool các đơn hàng còn lại của 200 khách này
            extras_pool = all_orders_of_selected[~all_orders_of_selected['id'].isin(base_orders['id'])]
            
            # Lấy mẫu đơn hàng dư, sử dụng min để tránh lỗi nếu tổng đơn vẫn không đủ 292
            num_to_sample = min(remaining_needed, len(extras_pool))
            if num_to_sample < remaining_needed:
                print(f"LƯU Ý: Không đủ đơn hàng sạch để đạt mốc {cfg['O']}. Chỉ lấy được {len(base_orders) + num_to_sample} đơn.")
            
            selected_orders = pd.concat([base_orders, extras_pool.sample(n=num_to_sample)])
        else:
            selected_customers = clean_customers_pool.sample(n=min(cfg['C'], len(clean_customers_pool)))
            c_ids = selected_customers['id'].unique()
            selected_orders = clean_orders_pool[clean_orders_pool['customer_id'].isin(c_ids)].groupby('customer_id').head(1)

        selected_customers.to_csv(os.path.join(path, 'customers.csv'), index=False)
        selected_orders.to_csv(os.path.join(path, 'orders.csv'), index=False)
        o_ids = selected_orders['id'].unique()

        # 4. Lọc Items và Correlations
        order_items_all[order_items_all['order_id'].isin(o_ids)].to_csv(os.path.join(path, 'order_items.csv'), index=False)
        
        c_ids_final = selected_customers['id'].unique()
        depot_ids = depots_all['id'].unique().tolist()
        mask_from = ((correlations_all['from_node_id'].isin(depot_ids) & (correlations_all['from_node_type'] == 'DEPOT')) |
                     (correlations_all['from_node_id'].isin(c_ids_final) & (correlations_all['from_node_type'] == 'CUSTOMER')))
        mask_to = ((correlations_all['to_node_id'].isin(depot_ids) & (correlations_all['to_node_type'] == 'DEPOT')) |
                   (correlations_all['to_node_id'].isin(c_ids_final) & (correlations_all['to_node_type'] == 'CUSTOMER')))
        correlations_all[mask_from & mask_to].to_csv(os.path.join(path, 'correlations.csv'), index=False)

        # 5. Copy file tĩnh
        for f in ['depots.csv', 'depots_products.csv', 'products.csv', 'product_exclude.csv', 'good_groups.csv', 'flyway_schema_history.csv']:
            shutil.copy(os.path.join(SOURCE_DIR, f), os.path.join(path, f))

    print("\nHoàn tất tạo dataset.")

if __name__ == "__main__":
    create_datasets()