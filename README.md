# GardenCare

App Next.js / TypeScript để ghi nhận chăm cây theo buổi, quản lý toàn bộ cây và đề xuất lịch 7 ngày. Deploy trên Vercel, lưu dữ liệu trong Neon PostgreSQL, quản lý schema bằng Drizzle.

## Chạy ngay trên máy

Yêu cầu Node.js 22 trở lên.

```sh
npm ci
npm run dev
```

Mở http://localhost:3000. Khi `DATABASE_URL` chưa được cấu hình, app chạy **chế độ xem thử** với dữ liệu từ tab `🌿 Plants`: 39 mục cây, 495 ngày chăm sóc, 6 nhóm (gồm WAITING rỗng).

Chế độ xem thử lưu thay đổi trên trình duyệt, không dùng Neon và không chạy AI thật. Bạn có thể thử nhập cả nhóm, hoàn tác, sửa cây, tạo nhóm và tạo lịch theo lịch sử. Thay đổi xem thử không tự nhập vào Neon. Nút đặt lại nằm trong Thiết lập.

## Kết nối Neon

1. Tạo database Neon dành cho GardenCare. Lấy PostgreSQL connection string trong mục Connect; giữ các tham số SSL Neon cung cấp.
2. Điền các biến bên dưới vào `.env.local` (ưu tiên hơn `.env`). `.env` hiện có với API key của bạn vẫn được giữ. Không commit hai file này.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
APP_PASSWORD=YOUR_LONG_UNIQUE_PASSWORD
SESSION_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-4.1-mini
```

`APP_PASSWORD` tối thiểu 12 ký tự; dùng mật khẩu dài, ngẫu nhiên, không dùng mật khẩu tài khoản khác. Bạn có thể tự tạo `SESSION_SECRET` bằng `openssl rand -hex 32`. Hai biến này bảo vệ dữ liệu và endpoint gọi AI bằng phiên đăng nhập có cookie HttpOnly.

3. Chạy migration và import:

```sh
npm run db:migrate
npm run db:seed
```

4. Khởi động lại `npm run dev`. Đăng nhập bằng `APP_PASSWORD`. App sẽ dùng database; dữ liệu xem thử không được trộn vào dữ liệu thực.

Seed chạy trong một giao dịch. ID lịch sử cố định nên chạy lại không nhân đôi dữ liệu, không ghi đè thông tin cây đã sửa. Không có bảng `import_batches`. Seed giữ các mục chung như Pothos / 2 chậu và Seedlings tổng hợp. Ngày Excel được lưu với loại `legacy_water_care`, không bịa giờ chính xác hay loại chăm nước cho cây thủy sinh. Thông tin và công thức A–K gốc nằm trong `plants.legacy_fields`; ngày lịch sử và địa chỉ ô nằm trong `care_events`.

## Deploy Vercel

1. Đưa source lên Git repository, rồi Import Project trong Vercel. Chọn framework **Next.js**, Node.js **24.x** hoặc **22.x**. Build command mặc định `npm run build`; root directory là thư mục dự án.
2. Thêm `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL` vào Environment Variables của Vercel. Không đặt tiền tố `NEXT_PUBLIC_`. Dùng database khác cho Preview nếu muốn thử mà không ảnh hưởng Production.
3. Chạy `db:migrate` và `db:seed` trên máy với URL database đích trước khi mở app thực. Deploy / Redeploy sau khi thay đổi biến môi trường.

Migration không tự chạy trong `next build`, tránh nhiều deployment cùng sửa database. Chưa có DATABASE_URL thì Vercel hiển thị xem thử; có database mà thiếu mật khẩu/secret thì app yêu cầu cấu hình thay vì mở quyền truy cập.

Route tạo lịch đặt `maxDuration = 300` giây. Agent có ngân sách 240 giây; thời gian thực phụ thuộc Vercel, OpenAI và mạng. Nếu lượt bị ngắt, khóa tạo lịch quá 5 phút được đánh dấu thất bại khi chạy lượt kế tiếp. Chỉ một lịch được tạo đồng thời cho vườn; không chạy cron tự động.

## Nhập liệu hằng ngày

- Chọn nhóm vừa tưới từ Hôm nay. Trong biểu mẫu, có thể chọn nhóm cộng dồn rồi bỏ chọn cây chưa tưới.
- Bấm **Lưu đã tưới N cây**: một buổi tạo N bản ghi cây trong một giao dịch.
- Ngày mặc định theo Pacific/Auckland, có Hôm qua và chọn ngày. Không ghi nhận tương lai. Ghi chú và quan sát độ ẩm không bắt buộc.
- Cây thủy sinh dùng Châm nước / Thay nước, không được ghi như tưới đất.
- Nhật ký có Hoàn tác cả buổi. Dữ liệu được giữ dấu hoàn tác và không còn tính vào lịch sử.
- UUID mỗi yêu cầu giúp gửi lại sau lỗi mạng không ghi trùng; gửi lại một buổi đã hoàn tác cũng không khôi phục nó.
- App có manifest/service worker. Thêm ra màn hình chính trong trình duyệt hỗ trợ. Sau khi đã mở app online, tài nguyên đã tải có thể mở lại khi mất mạng; bản ghi đã bấm Lưu được giữ trên thiết bị rồi đồng bộ khi có mạng. API không được cache.
- Hàng đợi ở Thiết lập có thử lại và bỏ bản ghi nếu thông tin không còn hợp lệ. Không đổi tài khoản hoặc đăng xuất khi còn bản ghi chờ. Xóa dữ liệu trình duyệt sẽ mất bản ghi chưa đồng bộ.

## Hai chế độ lập lịch

**Theo lịch sử**: khoảng trung bình từ các ngày chăm nước khác nhau đã ghi nhận, làm tròn đến ngày gần nhất (ít nhất một ngày), rồi tạo mốc trong 7 ngày. Không gọi OpenAI/thời tiết, không rút ngắn chu kỳ theo hồ sơ hoặc quan sát. Mốc trùng ngày được gom cùng buổi; không tự dời ngày. Cây thiếu hai ngày lịch sử chỉ có một lượt kiểm tra ban đầu, chưa suy ra chu kỳ.

**AI Agent**: giữ luồng công cụ từ bản Python, chuyển sang TypeScript để chạy trên Vercel:

```text
get_plants + get_weather → get_decision_bounds → optimize_schedule → finish_plan
```

AI đọc hồ sơ, lịch sử (trung vị các khoảng gần nhất như agent cũ), quan sát mới và thời tiết Open-Meteo. Code giới hạn quyết định, kiểm tra đủ cây và tối ưu số buổi trên 7 ngày. Chỉ lịch qua kiểm tra và được agent chốt mới được lưu. Lỗi quota hoặc thời tiết được báo rõ, không âm thầm đổi chế độ.

Hồ sơ có nguồn của sáu cây ban đầu đã được giữ. Cây khác có dữ liệu Excel và trường chưa xác nhận; AI không được bịa phần thiếu. Cập nhật môi trường trồng, mức nhận mưa, chậu và đặc tính trong Cây của tôi. Outdoor không đồng nghĩa nhận mưa; dự báo mưa không chứng minh đất ẩm. Gom sớm/muộn chỉ được bật trong hồ sơ, tối đa một ngày. Lịch đề xuất kiểm tra, không điều khiển tưới tự động. Lượt sau giả định lượt trước đã thực hiện; tạo lại lịch sau ghi nhận hoặc thay đổi thời tiết.

Lịch tưới hiển thị lịch đã lưu, thời tiết AI, lý do từng cây, token và **Tải JSON**. `GET /api/plans` trả JSON lịch gần nhất cho phiên đã đăng nhập. Thiết bị dùng API cần đăng nhập và giữ cookie phiên.

## Schema và migration

Nguồn schema: `src/db/schema.ts`. Migration SQL và snapshot được commit trong `drizzle/`. Drizzle dùng thêm bảng bookkeeping migration; không phải bảng dữ liệu import.

```sh
# Sau khi sửa schema.ts
npm run db:generate
# Xem SQL, đặc biệt DROP/ALTER và dữ liệu cần chuyển đổi
npm run db:migrate
```

Thử trên database phát triển trước, commit cả schema/migration, rồi áp dụng production. Không sửa migration đã áp dụng. Thêm một lần tưới là INSERT, không cần migration.

Bảy bảng ứng dụng: `gardens`, `plants`, `plant_groups`, `plant_group_members`, `care_sessions`, `care_events`, `watering_plans`.

## Kiểm tra

```sh
npm test
npm run typecheck
npm run build
```

Test dùng PostgreSQL nhúng PGlite: chạy migration thật, seed lặp, ghi nhiều cây nguyên tử, chống ghi trùng, hoàn tác, nhóm, lưu trữ cây và khóa tạo lịch. Test agent dùng transport giả lập, không tiêu token.

```sh
# AI thật, dùng token của key trong .env.local / .env
npm run check:ai
```

Lệnh thử sáu cây gốc/thời tiết thực, không cần Neon, không ghi database, chỉ in trạng thái và tổng token; không in key.

## Cấu trúc dự án

```text
src/app/          Giao diện, đăng nhập, API routes
src/lib/          Planner, AI tools, thời tiết, xác thực, validation
src/db/           Schema, connection, thao tác dữ liệu
drizzle/          Migration và snapshots
scripts/          Migrate, seed, kiểm tra AI
seed/garden.json  Dữ liệu Plants đã chuyển từ Excel
public/           Icon, manifest, service worker
tests/            Planner, agent, integration database
```

App dành cho một chủ vườn. Giới hạn đăng nhập trong bộ nhớ từng instance chỉ là bổ sung, không phải giới hạn toàn cục. Nếu phát triển nhiều người dùng, cần thêm hệ thống tài khoản và phân quyền theo vườn.

Tài liệu triển khai: [OpenAI Docs – Function calling](https://developers.openai.com/api/docs/guides/function-calling), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies), [Vercel function limits](https://vercel.com/docs/functions/limitations).
