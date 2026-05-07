import csv
import math
import os
import glob
import xml.etree.ElementTree as ET

# --- CẤU HÌNH ---
INPUT_DIR = './instances_raw'
OUTPUT_ROOT = './data_processed'

# Cấu hình chung
NUM_VEHICLES = 10             # Yêu cầu: 10 xe giống nhau
DEPOT_START = 21600.0         # 6:00 AM
DEPOT_END = 54000.0           # 15:00 PM
PROD_DELIVERY = 1
PROD_PICKUP = 2

# Bảng tra cứu sức chứa xe từ PDF Table 1
CAPACITY_MAP = {
    "Osaba_50_1_1": 240, "Osaba_50_1_2": 160, "Osaba_50_1_3": 240, "Osaba_50_1_4": 160,
    "Osaba_50_2_1": 240, "Osaba_50_2_2": 160, "Osaba_50_2_3": 240, "Osaba_50_2_4": 160,
    "Osaba_80_1": 240,   "Osaba_80_2": 160,   "Osaba_80_3": 240,   "Osaba_80_4": 160,
    "Osaba_100_1": 140,  "Osaba_100_2": 260,  "Osaba_100_3": 320
}

def ensure_dir(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

def write_csv(folder, filename, fieldnames, rows):
    path = os.path.join(folder, filename)
    with open(path, mode='w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

def calculate_distance(node1, node2):
    # Tính Euclidean cơ bản
    x1, y1 = float(node1['CoordX']), float(node1['CoordY'])
    x2, y2 = float(node2['CoordX']), float(node2['CoordY'])
    
    dist = math.sqrt((x1 - x2)**2 + (y1 - y2)**2)
    
    # Áp dụng Algorithm 3 (Off-peak) từ PDF cho tính bất đối xứng
    id1 = int(node1['id'])
    id2 = int(node2['id'])

    if id1 != 0 and id2 != 0:
        # Algorithm 3: 
        # Nếu id1 < id2: giữ nguyên (chiều xuôi)
        # Nếu id1 > id2: tính theo luật bất đối xứng (chiều ngược)
        if id1 > id2:
            # id1 ở đây đóng vai trò là 'j' (đích đến của chiều xuôi) trong thuật toán PDF
            if id1 % 2 != 0: # Nếu ID lớn là số lẻ
                return dist * 1.2
            else:            # Nếu ID lớn là số chẵn
                return dist * 0.8
                
    return dist

def process_file(xml_path):
    filename = os.path.basename(xml_path)
    instance_name = os.path.splitext(filename)[0]
    
    # Lấy capacity từ map, mặc định 200 nếu không tìm thấy
    veh_capacity = CAPACITY_MAP.get(instance_name, 200)
    
    output_dir = os.path.join(OUTPUT_ROOT, instance_name)
    ensure_dir(output_dir)
    
    print(f"Processing {instance_name} (Capacity: {veh_capacity}, Dist x1000, Fee: 3000)...")
    
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # --- 1. PARSE NODES ---
    nodes = {}
    for node_p in root.findall('NodeP'):
        nid = int(node_p.find('id').text)
        nodes[nid] = {
            'id': nid,
            'Cluster': int(node_p.find('Cluster').text),
            'DemEnt': float(node_p.find('DemEnt').text),
            'DemRec': float(node_p.find('DemRec').text),
            'CoordX': node_p.find('CoordX').text,
            'CoordY': node_p.find('CoordY').text
        }

    # --- 2. PARSE FORBIDDEN PATHS ---
    forbidden = set()
    for proh in root.findall('Prohibido'):
        u = int(proh.find('est1').text)
        v = int(proh.find('est2').text)
        forbidden.add((u, v))

    # --- GENERATE CSVs ---

    # depots.csv
    depot_node = nodes[0]
    write_csv(output_dir, 'depots.csv', ['id', 'latitude', 'longitude', 'start_time', 'end_time'], [{
        'id': 0,
        'latitude': depot_node['CoordX'],
        'longitude': depot_node['CoordY'],
        'start_time': DEPOT_START,
        'end_time': DEPOT_END
    }])

    # customers.csv
    cust_rows = []
    for nid, n in nodes.items():
        if nid == 0: continue
        cust_rows.append({
            'id': nid,
            'latitude': n['CoordX'],
            'longitude': n['CoordY'],
            'start_time': DEPOT_START,
            'end_time': DEPOT_END
        })
    write_csv(output_dir, 'customers.csv', ['id', 'latitude', 'longitude', 'start_time', 'end_time'], cust_rows)

    # vehicles.csv (Nhân bản 10 xe)
    veh_rows = []
    for i in range(1, NUM_VEHICLES + 1):
        veh_rows.append({
            'id': i,
            'type': 'TRUCK',
            # --- THAY ĐỔI: SET average_fee_transport = 3000 ---
            'average_fee_transport': 3000,
            'average_gas_consume': 0,
            'fixed_cost': 0,
            'max_travel_distance': 1000000,
            'max_load_weight': veh_capacity, 
            'max_capacity': veh_capacity
        })
    write_csv(output_dir, 'vehicles.csv', ['id', 'type', 'average_fee_transport', 'average_gas_consume', 
                                           'fixed_cost', 'max_travel_distance', 'max_load_weight', 'max_capacity'], veh_rows)

    # vehicles_products.csv
    vp_rows = []
    for i in range(1, NUM_VEHICLES + 1):
        vp_rows.append({'vehicle_id': i, 'product_id': PROD_DELIVERY})
        vp_rows.append({'vehicle_id': i, 'product_id': PROD_PICKUP})
    write_csv(output_dir, 'vehicles_products.csv', ['vehicle_id', 'product_id'], vp_rows)

    # orders.csv & order_items.csv
    orders_rows = []
    items_rows = []
    order_id_counter = 1
    item_id_counter = 1

    for nid, n in nodes.items():
        if nid == 0: continue
        
        total_w = n['DemEnt'] + n['DemRec']
        
        orders_rows.append({
            'id': order_id_counter,
            'customer_id': nid,
            'weight': total_w,
            'capacity': total_w, 
            'time_service': 0,
            'time_loading': 0
        })

        if n['DemEnt'] > 0:
            items_rows.append({
                'order_id': order_id_counter,
                'id': item_id_counter,
                'product_id': PROD_DELIVERY,
                'quantity': 1,
                'weight': n['DemEnt'],
                'capacity': n['DemEnt']
            })
            item_id_counter += 1

        if n['DemRec'] > 0:
            items_rows.append({
                'order_id': order_id_counter,
                'id': item_id_counter,
                'product_id': PROD_PICKUP,
                'quantity': 1,
                'weight': n['DemRec'],
                'capacity': n['DemRec']
            })
            item_id_counter += 1
            
        order_id_counter += 1

    write_csv(output_dir, 'orders.csv', ['id', 'customer_id', 'weight', 'capacity', 'time_service', 'time_loading'], orders_rows)
    write_csv(output_dir, 'order_items.csv', ['order_id', 'id', 'product_id', 'quantity', 'weight', 'capacity'], items_rows)

    # product_exclude.csv
    write_csv(output_dir, 'product_exclude.csv', ['product_excluding_id', 'excluded_product_id'], [])

    # correlations.csv
    corr_rows = []
    node_ids = sorted(nodes.keys())
    
    for u in node_ids:
        for v in node_ids:
            if u == v:
                dist = 0.0
            elif (u, v) in forbidden:
                dist = 1e9
            else:
                dist = calculate_distance(nodes[u], nodes[v])
            
            corr_rows.append({
                'from_node_id': u,
                'to_node_id': v,
                'from_node_type': 'DEPOT' if u == 0 else 'CUSTOMER',
                'to_node_type': 'DEPOT' if v == 0 else 'CUSTOMER',
                'distance': round(dist, 2),
                'time': round(dist, 2)
            })
            
    write_csv(output_dir, 'correlations.csv', ['from_node_id', 'to_node_id', 'from_node_type', 'to_node_type', 'distance', 'time'], corr_rows)

def main():
    xml_files = glob.glob(os.path.join(INPUT_DIR, '*.xml'))
    if not xml_files:
        print(f"No XML files found in {INPUT_DIR}")
        return

    print(f"Found {len(xml_files)} files. Starting conversion...")
    for xml_file in xml_files:
        try:
            process_file(xml_file)
        except Exception as e:
            print(f"Error processing {xml_file}: {e}")

    print("\n>>> All done! Check ./data_processed/")

if __name__ == "__main__":
    main()