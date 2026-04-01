# FixPulseHQ

FixPulseHQ is a Jira-style issue tracker built as a single Node.js application with an Express API and a React frontend served from the same server.

It supports company workspaces, JWT authentication, role-based team management, project-level issue tracking, dashboard analytics, and PostgreSQL-backed persistence.

## What The App Includes

- Company registration and login
- Multi-tenant organization isolation
- JWT-based authentication
- Admin, developer, and QA roles
- Team member invite, update, removal, and password reset flows
- Project creation and deletion
- Issue creation, editing, filtering, and deletion
- Kanban board with status-based workflow
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

1. Install Node.js
2. Install Docker Desktop
3. Install dependencies:

```bash
npm install
```

4. Start PostgreSQL:

```bash
npm run db:up
```

5. Start the app:

```bash
npm start
```

6. Open:

```text
http://localhost:3000
```

## Available Scripts

- `npm start` - start the production server
- `npm run dev` - start with `nodemon`
- `npm run db:up` - start PostgreSQL with Docker Compose
- `npm run db:down` - stop PostgreSQL
- `npm run db:logs` - view PostgreSQL logs
- `npm run db:reset` - recreate the database container and volume
- `npm run db:psql` - open a `psql` shell inside the container

## User Flow

1. Open the app
2. Register a company workspace or log in
3. The first registered user becomes the admin
4. Create projects
5. Add team members
6. Create and manage issues
7. Use the dashboard, board, list, team, and settings views

## Roles

- `admin`: can manage company settings, members, and passwords
- `developer`: can work with issues and projects
- `qa`: can work with issues and projects

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

## Frontend Views

- Authentication screen
- Dashboard
- Kanban board
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

- Add automated tests
- Add build tooling for the frontend
- Add pagination and server-side sorting
- Add richer audit logging
- Add file attachments and issue watchers
