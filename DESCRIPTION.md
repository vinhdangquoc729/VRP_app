# Project Description

## TCPVRP — Hệ thống điều phối vận chuyển đa ràng buộc

**Time-Constrained Pickup-Delivery Vehicle Routing Problem**

---

### Tổng quan

TCPVRP là hệ thống phần mềm quản lý và tối ưu hóa điều phối giao hàng nhiều phương tiện, được xây dựng nhằm giải quyết bài toán định tuyến xe có ràng buộc thực tế: tải trọng, thể tích, cửa sổ thời gian giao hàng, tính không tương thích giữa loại hàng hóa, giới hạn quãng đường và thời gian vận hành mỗi xe.

Hệ thống hỗ trợ ba vai trò người dùng — **Điều phối viên (Admin)**, **Khách hàng**, và **Tài xế** — hoạt động đồng thời trên cùng một nền tảng web, phản ánh quy trình vận hành logistics thực tế từ lúc đặt hàng đến khi giao hàng thành công.

---

### Bài toán giải quyết

Bài toán TCPVRP mở rộng VRP cổ điển với các yếu tố:

- Nhiều xe, mỗi xe có thể thực hiện nhiều chuyến trong ngày
- Cửa sổ thời gian cứng/mềm tại mỗi điểm giao
- Ràng buộc tải trọng và thể tích đồng thời
- Ma trận thời gian và khoảng cách lấy từ dữ liệu đường bộ thực (OSRM)
- Đơn hàng mới phát sinh trong khi xe đang hoạt động (Dynamic VRP)

---

### Giải pháp kỹ thuật

**Thuật toán tối ưu hóa**

- *Genetic Algorithm (GA)*: biểu diễn nhiễm sắc thể ba phần cho bài toán đa chuyến; khởi tạo bằng heuristic lân cận gần nhất; đánh giá fitness theo tổng chi phí + phạt vi phạm ràng buộc; giới hạn 500 thế hệ hoặc 10 giây thực thi.
- *Best-Insertion heuristic*: chèn đơn hàng mới vào lộ trình đang chạy theo vị trí có chi phí tăng thêm nhỏ nhất — Δc(i,j,o) = d(i,o) + d(o,j) − d(i,j) — trong O(n), không cần khởi động lại GA.

**Tích hợp dữ liệu thực**

- OSRM Table API: xây dựng ma trận thời gian và khoảng cách giữa tất cả điểm giao
- OSRM Route API: lấy hình học đường đi thực để mô phỏng GPS tài xế
- Fallback Haversine khi dịch vụ OSRM không khả dụng

**Kiến trúc hệ thống**

| Tầng | Công nghệ |
|------|-----------|
| Backend | Python 3.12, FastAPI, Pydantic |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Bản đồ | Leaflet.js + react-leaflet |
| Routing | OSRM (public instance / self-hosted) |
| Lưu trữ | JSON file-based (demo) |

---

### Tính năng chính

**Admin — Điều phối viên**
- Chạy GA với thanh tiến trình trực tiếp qua Server-Sent Events
- Chỉnh sửa kéo-thả thứ tự điểm dừng, tính lại chi phí tức thì
- Mô phỏng lịch trình theo trục thời gian
- Điều phối trực tiếp: theo dõi GPS tất cả tài xế đang hoạt động, chèn đơn mới vào lộ trình
- Quản lý đơn hàng: lọc đa chiều (trạng thái, danh mục, khoảng ngày, tìm kiếm), cập nhật/huỷ theo lô
- Thống kê: biểu đồ xu hướng theo ngày, phân bổ theo danh mục, bảng xếp hạng tài xế
- Ngày điều phối giả lập: kiểm soát `created_at` của toàn bộ đơn hàng

**Khách hàng**
- Đặt hàng qua danh mục sản phẩm
- Theo dõi trạng thái đơn theo thời gian thực với timeline từng bước
- Huỷ đơn khi ở trạng thái cho phép (`pending`, `failed`)

**Tài xế**
- Xem lộ trình được phân công theo thứ tự điểm dừng
- Cập nhật trạng thái từng điểm: bắt đầu giao → đã giao / giao không thành công
- GPS mô phỏng di chuyển dọc tuyến đường thực sau mỗi cập nhật

**Vòng đời đơn hàng**
```
pending → assigned → in_transit → delivered
                              ↘ failed
pending / failed ─────────────→ cancelled
```

---

### Quy mô

- 21 REST API endpoints, 1 SSE endpoint
- Dữ liệu demo: ~320 đơn hàng, 16 danh mục sản phẩm, nhiều khách hàng và tài xế
- Thuật toán được thử nghiệm với các bộ benchmark VRP tiêu chuẩn và dữ liệu ngẫu nhiên
