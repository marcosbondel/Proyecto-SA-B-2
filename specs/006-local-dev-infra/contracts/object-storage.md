# Contract: Object Storage

Contract for the MinIO-based transfer buffer introduced by [ADR-012](../../docs/architecture/adr/ADR-012-object-storage.md). This is not a service database; it holds no business state.

## Bucket

| Property | Value |
|---|---|
| `name` | `customer-identity-documents` |
| `purpose` | Transfer buffer for identity-document photos between the Gateway and Customer Service |
| `createdBy` | `init-minio.sh` at stack startup |
| `versioning` | Disabled |
| `retention` | Lifecycle rule expires objects after `MINIO_RETENTION_HOURS` (default 24 hours) |

## Object reference

The only data that travels through RabbitMQ is the reference, not the bytes.

| Field | Type | Description |
|---|---|---|
| `key` | string | Object key in the bucket, unique per upload |
| `contentType` | string | MIME type of the original file |
| `size` | number | Size in bytes |
| `sha256` | string | SHA-256 of the object content |

## Access policy

| User | Permissions |
|---|---|
| `MINIO_ROOT_USER` | Full console and S3 admin access (development only) |
| `MINIO_APP_USER` | `s3:GetObject` and `s3:PutObject` only on `customer-identity-documents` |

## Validation contract

- Customer Service MUST recompute the SHA-256 of the downloaded object and compare it to the reference before persisting the bytes.
- A missing object or a hash mismatch MUST be treated as a distinct failure from a network error.
- Objects older than the retention window MUST be removed automatically by MinIO.
