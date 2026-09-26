import boto3  # type: ignore[import-untyped]
from botocore.client import BaseClient  # type: ignore[import-untyped]
from botocore.exceptions import ClientError  # type: ignore[import-untyped]

from app.core.config import settings
from app.logger import app_logger


class MinioEngine:
    """Singleton MinIO/S3 client wrapper."""

    _instance: "MinioEngine | None" = None

    def __init__(self) -> None:
        self._client: BaseClient = boto3.client(
            "s3",
            endpoint_url=settings.MINIO_ENDPOINT,
            aws_access_key_id=settings.MINIO_ROOT_USER,
            aws_secret_access_key=settings.MINIO_ROOT_PASSWORD,
            region_name=settings.MINIO_REGION,
        )

    @classmethod
    def get_instance(cls) -> "MinioEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def client(self) -> BaseClient:
        return self._client

    def ensure_bucket(self, bucket: str) -> None:
        try:
            self._client.head_bucket(Bucket=bucket)
            return
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code", "")
            if code not in ("404", "NoSuchBucket", "NotFound"):
                raise

        self._client.create_bucket(Bucket=bucket)
        app_logger.info("Created object storage bucket: %s", bucket)

    def upload_file(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def delete_file(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


# Backward-compatible module-level helpers
def ensure_bucket(bucket: str) -> None:
    MinioEngine.get_instance().ensure_bucket(bucket)
