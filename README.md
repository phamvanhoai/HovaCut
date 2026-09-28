# HovaCut

**HovaCut** là phần mềm dựng video và tự động hóa media chạy trực tiếp trên Windows, được phát triển bởi **HovaIT**. Ứng dụng kết hợp editor timeline của [OpenCut](https://github.com/OpenCut-app/OpenCut) với các công cụ xử lý hàng loạt bằng FFmpeg.

> Copyright © 2026 HovaIT. All rights reserved.

## Tính năng

### Editor thủ công

- Quản lý nhiều project trên máy tính.
- Nhập, liên kết lại và sử dụng video, hình ảnh, âm thanh trực tiếp từ ổ đĩa.
- Timeline nhiều track; cắt, sắp xếp và chỉnh sửa clip.
- Preview video, ảnh và âm thanh ngay trong project.
- Text, sticker, effect, mask, caption và các thuộc tính hình ảnh.
- Lưu project trên máy, nhập/xuất project JSON.
- Xuất video bằng renderer của OpenCut hoặc FFmpeg khi tương thích.

### Automation

- **Auto Video:** chọn thư mục video, xáo trộn, nối/lặp đủ thời lượng audio và phủ logo.
- **Auto MP3:** tạo playlist nhạc hàng loạt.
- **Ảnh + Audio:** tạo video MP4 từ ảnh tĩnh và audio.
- **Convert Media:** chuyển đổi video/audio sang các định dạng phổ biến.
- **Ghép / Random MP3:** sắp xếp, ghim, di chuyển và xáo trộn playlist.
- **Video → Images:** trích xuất khung hình theo khoảng thời gian.
- **Ghép / Random Video:** nối nhiều video theo thứ tự hoặc ngẫu nhiên.
- **Lofi Video:** ghép nền, audio, effect và logo alpha.
- **TXT / File List:** tạo danh sách file, xáo trộn TXT, đổi kiểu chữ và xử lý tên bài hát.
- Theo dõi tiến trình, thời gian xử lý và hủy tác vụ render.
- Tự phát hiện NVIDIA NVENC, Intel QSV, AMD AMF và tự chuyển về CPU khi GPU encoder không khả dụng.

## Kiến trúc desktop

HovaCut Desktop sử dụng:

- [Tauri 2](https://tauri.app/) cho ứng dụng Windows native.
- Next.js/React cho giao diện.
- Rust cho lưu trữ project, đọc media và điều phối tác vụ native.
- FFmpeg cho xử lý và xuất media hàng loạt.
- OpenCut Classic cho editor timeline và compositor.

Ứng dụng desktop chạy bằng tài nguyên tĩnh được đóng gói trong EXE, vì vậy **không cần chạy localhost hoặc Next.js server** sau khi cài đặt. Media được đọc trực tiếp từ ổ đĩa; video lớn không bị tải toàn bộ vào RAM chỉ để preview.

## Yêu cầu trên Windows

- Windows 10/11 64-bit.
- Microsoft Edge WebView2 Runtime.
- FFmpeg có hỗ trợ H.264/AAC.
- Khi build mã nguồn: Rust, Node.js, Bun và Visual Studio Build Tools với workload **Desktop development with C++**.

HovaCut ưu tiên FFmpeg tại:

```text
E:\CGT Auto Tools v1.3.0\ffmpeg.exe
```

Nếu không tìm thấy, ứng dụng sử dụng `ffmpeg.exe` có trong biến môi trường `PATH`.

## Cài đặt

Bộ cài NSIS sau khi build nằm tại:

```text
classic\apps\desktop\src-tauri\target\release\bundle\nsis\HovaCut_0.1.0_x64-setup.exe
```

Chạy file cài đặt, sau đó mở **HovaCut Desktop** từ Start Menu. Có thể cài đè phiên bản mới mà không cần xóa project cũ.

## Chạy mã nguồn desktop

Mở **Visual Studio Developer PowerShell/Command Prompt**, sau đó:

```powershell
cd classic\apps\desktop\src-tauri
cargo tauri dev
```

Lệnh trên tự chuẩn bị frontend desktop trước khi khởi động Tauri.

## Build bộ cài Windows

```powershell
cd classic\apps\desktop\src-tauri
cargo tauri build --bundles nsis
```

Nếu terminal thông thường không nhận MSVC, chạy lệnh trong **Visual Studio Developer Command Prompt** hoặc nạp `VsDevCmd.bat` trước khi build.

## Cấu trúc chính

```text
classic/apps/web/                 Giao diện editor và Automation
classic/apps/desktop-ui/          Entry point Next.js cho bản desktop tĩnh
classic/apps/desktop/src-tauri/   Backend Rust, cấu hình Tauri và bộ cài
scripts/                          Script hỗ trợ chạy các workspace
```

Repository vẫn giữ phần OpenCut rewrite ở thư mục gốc để tham khảo và tiếp tục chuyển đổi. Sản phẩm HovaCut Desktop hiện tại được build từ nhánh `classic`.

## Trạng thái hiện tại

- Editor thủ công và các công cụ Automation chính đã chạy trên desktop.
- Preview media local đã được tích hợp với luồng đọc file native.
- Render chạy ở background để hạn chế giao diện bị `Not Responding`.
- Mục **Transitions** của OpenCut Classic hiện chưa có engine transition hoàn chỉnh và vẫn đang được phát triển.
- Một số chức năng editor nâng cao có thể tiếp tục được chuyển sang Rust/native trong các phiên bản sau.

## Nguồn mở và ghi nhận

HovaCut được phát triển dựa trên mã nguồn OpenCut và tiếp tục giữ giấy phép/ghi nhận của dự án nguồn trong repository. Xem [LICENSE](LICENSE) và [OpenCut](https://github.com/OpenCut-app/OpenCut) để biết thêm thông tin.

Các thay đổi, giao diện desktop, công cụ Automation và phần tích hợp HovaCut thuộc bản quyền HovaIT.

## Bản quyền

**HovaCut — Copyright © 2026 HovaIT. All rights reserved.**
