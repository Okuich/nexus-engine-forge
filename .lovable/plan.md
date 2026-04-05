
## Plan: Core Fabrication OS

### 1. Database — New tables
- **`fabrication_jobs`** — supplier-side jobs (linked to RFQ awards from Midwater)
  - Fields: title, status (queued/in_progress/qc/complete/shipped), supplier_id, rfq_id, material, process, quantity, due_date, priority, notes
- **`fabrication_schedules`** — time slots for each job
  - Fields: job_id, start_date, end_date, machine/resource, status
- **`fabrication_quotes`** — supplier quotes back to Midwater buyers
  - Fields: job_id, rfq_id, unit_price, lead_time_days, breakdown (JSON), status (draft/sent/accepted/rejected)

### 2. Service layer — `src/services/fabrication/`
- `jobManager.ts` — CRUD + status transitions for fab jobs
- `scheduler.ts` — schedule jobs against capacity, detect conflicts
- `quoter.ts` — generate quotes with cost breakdown, link to Midwater RFQs
- `index.ts` — barrel exports

### 3. Frontend — New pages & components
- `/fabrication` route (Fabrication OS product, supplier role)
- **Jobs dashboard** — kanban-style status board (queued → in progress → QC → complete → shipped)
- **Schedule view** — timeline/calendar of upcoming jobs
- **Quoting panel** — create/send quotes linked to incoming RFQs
- Add to sidebar under a new "Fabrication" nav group (fabrication_os product only)

### 4. Midwater integration
- When an RFQ is awarded in Midwater → auto-create a fabrication job for the supplier
- Quote status syncs back to Midwater's RFQ quote status

### 5. Product boundary
- Add `/fabrication` route to `fabrication_os` product routes
- Add "Fabrication" nav group mapping
