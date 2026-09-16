# Users API

This document describes the authentication and user-management API exposed by
the CRM backend. It is intentionally limited to user-related functionality so
it can be shared with another application or platform.

## 1. Connection Details

The backend mounts the API under `/api`.

| Setting | Value |
| --- | --- |
| Local base URL | `https://crm-backend-t1qk.onrender.com/api` |
| User endpoints | `/users` |
| Authentication endpoints | `/auth` |
| Content types | `application/json` and `multipart/form-data` for avatar uploads |
| Database | MongoDB (internal implementation detail) |

For another environment, replace the local base URL with the deployed API URL.
The backend port is controlled by the `PORT` environment variable.

## 2. Authentication

All `/users` endpoints require a valid access token. First call the login or
registration endpoint, then send the returned token on every protected request:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Tokens are JWTs signed by the backend. Their lifetime is configured by the
backend's `JWT_EXPIRE` environment variable. The token contains the user's ID;
the client should treat it as opaque and should not try to edit it.

### Standard error format

Most errors use this JSON shape:

```json
{
  "success": false,
  "message": "Explanation of the error"
}
```

Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid input or duplicate email |
| `401` | Missing, invalid, or expired token; invalid credentials |
| `403` | Authenticated user does not have the required role, or is inactive |
| `404` | User does not exist |
| `500` | Unexpected server or database error |

## 3. Login and Session Endpoints

### Register

```http
POST /api/auth/register
Content-Type: application/json
```

Request:

```json
{
  "name": "Asha Sharma",
  "email": "asha@example.com",
  "password": "ChangeMe123!",
  "role": "team_member"
}
```

`name`, `email`, and `password` are required. Supported public registration
roles are `manager`, `team_member`, `member`, and `client`. Any other role is
replaced with `team_member`.

Success: `201 Created`

```json
{
  "success": true,
  "token": "JWT_TOKEN",
  "user": {
    "_id": "65f1...",
    "name": "Asha Sharma",
    "email": "asha@example.com",
    "role": "team_member",
    "avatar": "",
    "department": "",
    "phone": "",
    "permissions": {}
  }
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "asha@example.com",
  "password": "ChangeMe123!"
}
```

Success: `200 OK`. The response has the same `token` and `user` structure as
registration. Email matching is case-insensitive.

### Get current user

```http
GET /api/auth/me
Authorization: Bearer YOUR_JWT_TOKEN
```

Success:

```json
{
  "success": true,
  "user": {
    "_id": "65f1...",
    "name": "Asha Sharma",
    "email": "asha@example.com",
    "role": "team_member",
    "avatar": "",
    "department": "Engineering",
    "phone": "+91 9876543210",
    "permissions": {}
  }
}
```

### Update own profile

```http
PUT /api/auth/updateprofile
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | No | Display name |
| `phone` | string | No | Phone number |
| `department` | string | No | Department name |
| `avatar` | file | No | Profile image or supported document, max 10 MB |

The response is `200 OK` with `{ "success": true, "user": { ... } }`.

### Change password

```http
PUT /api/auth/changepassword
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

Request:

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

Success:

```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

## 4. User Management Endpoints

All endpoints in this section require a token and the organization's `team`
module must be enabled.

### List users

```http
GET /api/users
Authorization: Bearer YOUR_JWT_TOKEN
```

Optional query parameters:

| Parameter | Default | Description |
| --- | --- | --- |
| `role` | none | Exact role filter |
| `search` | none | Case-insensitive search in `name` or `email` |
| `page` | `1` | Page number |
| `limit` | `20` | Number of users per page |

Example:

```http
GET /api/users?search=asha&role=team_member&page=1&limit=20
```

Success:

```json
{
  "success": true,
  "total": 1,
  "page": 1,
  "users": [
    {
      "_id": "65f1...",
      "name": "Asha Sharma",
      "email": "asha@example.com",
      "role": "team_member",
      "avatar": "/uploads/1710000000000-123456789.jpg",
      "department": "Engineering",
      "phone": "+91 9876543210",
      "company": "Example Ltd",
      "shiftCode": "GENERAL",
      "isActive": true,
      "createdAt": "2026-09-08T10:00:00.000Z",
      "updatedAt": "2026-09-08T10:00:00.000Z"
    }
  ]
}
```

Users are sorted newest first. The password is never returned by this
endpoint.

### Get one user

```http
GET /api/users/:id
Authorization: Bearer YOUR_JWT_TOKEN
```

Example:

```http
GET /api/users/65f1abc1234567890abcdef0
```

Success:

```json
{
  "success": true,
  "user": {
    "_id": "65f1abc1234567890abcdef0",
    "name": "Asha Sharma",
    "email": "asha@example.com",
    "role": "team_member",
    "avatar": "",
    "department": "Engineering",
    "phone": "+91 9876543210",
    "company": "Example Ltd",
    "shiftCode": "GENERAL",
    "isActive": true,
    "lastLogin": "2026-09-08T10:05:00.000Z",
    "createdAt": "2026-09-08T10:00:00.000Z",
    "updatedAt": "2026-09-08T10:05:00.000Z"
  }
}
```

### Get user avatar

```http
GET /api/users/:id/avatar
Authorization: Bearer YOUR_JWT_TOKEN
```

This endpoint returns the image bytes directly when an avatar exists. If no
avatar has been uploaded, it returns an SVG placeholder containing the user's
initials. Use the response as an image URL or download it as binary data; it is
not a JSON response on success.

### Create a user (admin)

```http
POST /api/users
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: multipart/form-data
```

Allowed caller roles: `super_admin` and `admin`.

Fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | User's name |
| `email` | string | Yes | Unique email address |
| `password` | string | Yes except for `client` | Minimum 6 characters |
| `role` | string | No | See supported roles below |
| `department` | string | No | Department name |
| `phone` | string | No | Phone number |
| `company` | string | No | Company or organization name |
| `shiftCode` | string | No | Shift identifier |
| `avatar` | file | No | Avatar/upload file, max 10 MB |

Supported roles are `super_admin`, `admin`, `hr`, `manager`, `team_lead`,
`team_member`, `member`, and `client`. Only a `super_admin` can create a
`super_admin` account.

Success: `201 Created`, with `{ "success": true, "user": { ... } }`.

### Update a user (admin)

```http
PUT /api/users/:id
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: multipart/form-data
```

Allowed caller roles: `super_admin`, `admin`, `manager`.

Accepted fields are `name`, `role`, `department`, `phone`, `company`,
`isActive`, `customPermissions`, `shiftCode`, and optional `avatar`.

`customPermissions` must be sent as an object when using JSON. With
`multipart/form-data`, send it as a JSON string and parse it in the receiving
client before displaying it. Only a `super_admin` can change a user's role to
or from `super_admin`. Role changes are recorded in the permission audit log.

Success:

```json
{
  "success": true,
  "user": {
    "_id": "65f1...",
    "name": "Asha Sharma",
    "role": "manager"
  }
}
```

The actual response includes the complete user document except the password.

### Delete a user (admin)

```http
DELETE /api/users/:id
Authorization: Bearer YOUR_JWT_TOKEN
```

Allowed caller roles: `super_admin` and `admin`. A non-super-admin cannot
delete a `super_admin`.

Success:

```json
{
  "success": true,
  "message": "User deleted"
}
```

Deletion is permanent at the database level. Use `PUT` with `isActive: false`
when the other platform needs to deactivate an account without deleting it.

## 5. User Object

The user model contains these fields:

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | MongoDB ObjectId string | Unique user ID |
| `name` | string | Required |
| `email` | string | Required and unique; stored lowercase |
| `role` | string | Defaults to `team_member` |
| `additionalRoles` | ObjectId array | References role records |
| `customPermissions` | object or null | Per-user permission overrides |
| `temporaryPermissions` | object array | Temporary permissions with expiry |
| `avatar` | string | Stored upload path, often `/uploads/<filename>` |
| `department` | string | Defaults to empty string |
| `phone` | string | Defaults to empty string |
| `company` | string | Defaults to empty string |
| `shiftCode` | string | Defaults to empty string |
| `isActive` | boolean | Defaults to `true` |
| `lastLogin` | ISO date or null | Updated at login |
| `createdAt` | ISO date | Added automatically |
| `updatedAt` | ISO date | Added automatically |

The `password` field is hashed with bcrypt and is intentionally excluded from
normal API responses.

## 6. Ready-to-use cURL Examples

```bash
# Login and save the token from the response
curl -X POST https://crm-backend-t1qk.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'

# List users
curl https://crm-backend-t1qk.onrender.com/api/users?page=1\&limit=20 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Create a user with an avatar
curl -X POST https://crm-backend-t1qk.onrender.com/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "name=Asha Sharma" \
  -F "email=asha@example.com" \
  -F "password=ChangeMe123!" \
  -F "role=team_member" \
  -F "department=Engineering" \
  -F "avatar=@C:/photos/asha.jpg"

# Deactivate a user
curl -X PUT https://crm-backend-t1qk.onrender.com/api/users/65f1abc1234567890abcdef0 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "isActive=false"
```

## 7. Integration Checklist

1. Configure the consuming platform with the deployed API base URL.
2. Call `/api/auth/login` and store the returned token securely.
3. Add `Authorization: Bearer <token>` to every protected request.
4. Treat `_id` as the stable external user identifier.
5. Use `isActive: false` for soft deactivation and `DELETE` only for permanent removal.
6. Use `/api/users/:id/avatar` for displaying avatars instead of assuming the stored path is publicly reachable.
7. Handle `401` by requiring a new login and handle `403` as a permissions or disabled-module response.