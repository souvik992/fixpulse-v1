# FixPulse v1

FixPulse is a issue tracker built as a single Node.js application with an Express API and a React frontend served from the same server.

It supports company workspaces, JWT authentication, role-based team management, project-level issue tracking, dashboard analytics, and PostgreSQL-backed persistence.

## What The App Includes

- Company registration and login
- Multi-tenant organization isolation
- JWT-based authentication
- RBAC with system roles, custom roles, and project-level assignments
- Team member invite, update, removal, and password reset flows
- Project creation and deletion
- Issue creation, editing, filtering, and deletion
- Dashboard stats by status, priority, type, and daily issue volume
- Comments and activity history on issues
- Organization settings for admins

## Tech Stack

- Backend: Node.js, Express
- Frontend: React 18 loaded in the browser via CDN
- Charts: Chart.js
- Auth: JSON Web Tokens + bcrypt
- Database: PostgreSQL via `pg`
- Local development database: Docker Compose

## Project Structure

```text
.
|-- public/
|   |-- index.html
|   |-- app.js
|   `-- styles.css
|-- db/
|   |-- index.js
|   |-- schema.sql
|   `-- seed.sql
|-- server.js
|-- package.json
|-- docker-compose.yml
`-- .env
```

## How It Works

When the server starts, it connects to PostgreSQL using the values in `.env`. If PostgreSQL is unavailable, the server exits instead of falling back to local file storage.

## Environment Variables

The app expects a local `.env` file like this:

```env
PORT=3000

JWT_SECRET=bugtracker_jwt_super_secret_key_2024
JWT_EXPIRES_IN=7d

DB_HOST=localhost
DB_PORT=5432
DB_NAME=bugtracker
DB_USER=bugtracker
DB_PASSWORD=bugtracker_secret
```

## Running The App

Open the app at `http://localhost:3000` after your environment is already running.

## Available Scripts

- `npm start` - start the production server
- `npm run dev` - start with `nodemon`

## User Flow

1. Open the app
2. Register a company workspace or log in
3. The first registered user becomes the admin
4. Create projects
5. Add team members
6. Create and manage issues
7. Use the dashboard, issue list, team, and settings views

## Roles

- `admin`: full system access
- `project_manager`: project-level control
- `developer`: work on assigned issues
- `frontend_developer`: frontend-focused developer access
- `backend_developer`: backend-focused developer access
- `tester`: create and verify bugs
- `viewer`: read-only access

## Main API Endpoints

### Auth

- `POST /api/auth/register-company`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Organization

- `GET /api/org`
- `PUT /api/org`

### Members

- `GET /api/members`
- `POST /api/members`
- `PUT /api/members/:id`
- `DELETE /api/members/:id`
- `POST /api/members/:id/reset-password`

### Projects

- `GET /api/projects`
- `POST /api/projects`
- `DELETE /api/projects/:id`

### Issues

- `GET /api/bugs`
- `GET /api/bugs/:id`
- `POST /api/bugs`
- `PUT /api/bugs/:id`
- `DELETE /api/bugs/:id`

### Comments

- `POST /api/bugs/:id/comments`
- `DELETE /api/bugs/:id/comments/:cid`

### Stats

- `GET /api/stats`

### RBAC

- `GET /api/rbac/permissions`
- `GET /api/rbac/roles`
- `POST /api/rbac/roles`
- `PUT /api/rbac/roles/:id/permissions`
- `POST /api/rbac/roles/:id/permissions`
- `DELETE /api/rbac/roles/:id/permissions/:permission`
- `DELETE /api/rbac/roles/:id`
- `GET /api/rbac/users/:userId/roles`
- `POST /api/rbac/users/:userId/roles`
- `DELETE /api/rbac/users/:userId/roles/:userRoleId`
- `GET /api/rbac/me/permissions`
- `GET /api/rbac/users/:userId/permissions`

## Frontend Views

- Authentication screen
- Dashboard
- Issues list
- Projects page
- Team page
- Company settings page

## Notes

- The frontend is served directly from `public/`
- The app currently uses CDN-loaded React instead of a bundler-based frontend setup
- Authentication tokens are stored in `localStorage`
- The server serves `public/index.html` for all non-API routes

## Future Improvements

- Expand the automated RBAC and API test coverage
- Add build tooling for the frontend
- Add pagination and server-side sorting
- Add richer audit logging
- Add file attachments and issue watchers
