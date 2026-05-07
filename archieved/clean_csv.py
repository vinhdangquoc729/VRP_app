import csv
import os

# Cấu hình folder đầu vào
SOURCE_FOLDER = 'all\\DS5'
# Tên folder đầu ra sẽ tự động thêm đuôi _new
TARGET_FOLDER = f"{SOURCE_FOLDER.rstrip('/')}_new"

# Định nghĩa các cột CẦN GIỮ LẠI cho từng file
SCHEMA_MAPPING = {
    'correlations.csv': [
        'from_node_id', 'to_node_id', 'from_node_type', 'to_node_type', 'distance', 'time'
    ],
    'customers.csv': [
        'id', 'latitude', 'longitude', 'start_time', 'end_time'
    ],
    'vehicles.csv': [
        'id', 'type', 'average_fee_transport', 'average_gas_consume', 
        'fixed_cost', 'max_travel_distance', 'max_load_weight', 'max_capacity'
    ],
    'orders.csv': [
        'id', 'customer_id', 'time_service', 'time_loading', 'weight', 'capacity'
    ],
    'order_items.csv': [
        'id', 'product_id', 'quantity', 'weight', 'capacity', 'order_id'
    ],
    'depots.csv': [
        'id', 'latitude', 'longitude', 'start_time', 'end_time'
    ],
    'vehicles_products.csv': [
        'vehicle_id', 'product_id'
    ],
    'product_exclude.csv': [
        'product_excluding_id', 'excluded_product_id'
    ]
}

def clean_csv_files():
    # 1. Tạo folder đích
    if not os.path.exists(TARGET_FOLDER):
        os.makedirs(TARGET_FOLDER)
        print(f"Created new folder: {TARGET_FOLDER}")
    else:
        print(f"Folder already exists: {TARGET_FOLDER}")

    # 2. Duyệt qua các file trong cấu hình SCHEMA
    for filename, keep_columns in SCHEMA_MAPPING.items():
        src_path = os.path.join(SOURCE_FOLDER, filename)
        dst_path = os.path.join(TARGET_FOLDER, filename)

        if not os.path.exists(src_path):
            print(f"[SKIP] File not found: {filename}")
            continue

        print(f"Processing {filename}...", end=" ")

        try:
            with open(src_path, mode='r', encoding='utf-8-sig', newline='') as f_in:
                reader = csv.DictReader(f_in)
                
                # Chỉ lấy giao của (các cột cần giữ) và (các cột thực tế có trong file)
                actual_headers = reader.fieldnames if reader.fieldnames else []
                valid_headers = [col for col in keep_columns if col in actual_headers]
                
                if not valid_headers:
                    print(f"-> Skipped (No matching columns found)")
                    continue

                with open(dst_path, mode='w', encoding='utf-8', newline='') as f_out:
                    writer = csv.DictWriter(f_out, fieldnames=valid_headers, extrasaction='ignore')
                    writer.writeheader()
                    
                    row_count = 0
                    for row in reader:
                        # --- LOGIC MỚI: Gán latitude/longitude về 0 ---
                        if 'latitude' in row:
                            row['latitude'] = 0
                        if 'longitude' in row:
                            row['longitude'] = 0
                        # ----------------------------------------------

                        # DictWriter với extrasaction='ignore' sẽ tự động bỏ các key thừa
                        writer.writerow(row)
                        row_count += 1
                        
                print(f"-> Done ({row_count} rows). Saved to {dst_path}")

        except Exception as e:
            print(f"-> Error: {e}")

if __name__ == "__main__":
    if os.path.exists(SOURCE_FOLDER):
        clean_csv_files()
        print("\nHoàn tất quá trình lọc dữ liệu và ẩn tọa độ.")
    else:
        print(f"Lỗi: Không tìm thấy folder nguồn '{SOURCE_FOLDER}'")