# FixPulseHQ – Jira-like Bug Tracking App

A full-stack bug/issue tracking web application built with Node.js + Express + React.

## Quick Start

1. Open a terminal in this folder
2. Run: `node server.js`
3. Open your browser to: **http://localhost:3000**

> Node.js must be installed. Dependencies (express, cors, uuid) are included in `node_modules/`.

## Features

- **Dashboard** – Stats cards + Line/Doughnut/Bar charts showing issue trends
- **Kanban Board** – Drag-and-drop cards across To Do / In Progress / In Review / Done
- **Issue List** – Sortable table with search and multi-filter (status, priority, type, assignee)
- **Issue Detail** – Full detail view with inline status/priority/assignee editing
- **Comments** – Add, view and delete comments on issues
- **Activity Log** – Tracks status/priority/assignee changes with timestamps
- **Projects** – Create and manage multiple projects with colour coding
- **Team** – View team members and their issue stats

## Data

All data is stored in `data/db.json` (auto-created on first run with sample data).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/projects | List projects |
| POST | /api/projects | Create project |
| GET | /api/bugs | List issues (filterable) |
| POST | /api/bugs | Create issue |
| PUT | /api/bugs/:id | Update issue |
| DELETE | /api/bugs/:id | Delete issue |
| POST | /api/bugs/:id/comments | Add comment |
| GET | /api/stats | Dashboard statistics |
| GET | /api/users | List users |
