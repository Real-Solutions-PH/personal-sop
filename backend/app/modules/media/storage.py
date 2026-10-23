"""Object storage seam for media. ``client()`` is the one place tests may
substitute; everything else goes through these functions."""

from typing import Any

import boto3  # type: ignore[import-untyped]
from botocore.client import BaseClient  # type: ignore[import-untyped]
from botocore.config import Config  # type: ignore[import-untyped]

from app.core.config import settings
from app.core.storage import MinioEngine

_public: BaseClient | None = None
_bucket_ready = False


def client() -> BaseClient:
    return MinioEngine.get_instance().client


def _public_client() -> BaseClient:
    """Signs URLs for the host phones reach (the signature covers the host)."""
    global _public
    if settings.MEDIA_PUBLIC_ENDPOINT is None:
        return client()
    if _public is None:
        _public = boto3.client(
            "s3",
            endpoint_url=settings.MEDIA_PUBLIC_ENDPOINT,
            region_name=settings.MINIO_REGION,
            config=Config(signature_version="s3v4"),
            **settings.object_storage_credentials(),
        )
    return _public


def ensure_bucket() -> None:
    global _bucket_ready
    if not _bucket_ready:
        MinioEngine.get_instance().ensure_bucket(settings.MEDIA_BUCKET)
        _bucket_ready = True


def presign_put(key: str, mime: str, size: int) -> str:
    ensure_bucket()
    url: str = _public_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.MEDIA_BUCKET,
            "Key": key,
            "ContentType": mime,
            "ContentLength": size,
        },
        ExpiresIn=settings.MEDIA_URL_TTL_SECONDS,
    )
    return url


def presign_get(key: str) -> str:
    url: str = _public_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MEDIA_BUCKET, "Key": key},
        ExpiresIn=settings.MEDIA_URL_TTL_SECONDS,
    )
    return url


def head(key: str) -> dict[str, Any] | None:
    from botocore.exceptions import ClientError  # type: ignore[import-untyped]

    try:
        out: dict[str, Any] = client().head_object(
            Bucket=settings.MEDIA_BUCKET, Key=key
        )
        return out
    except ClientError:
        return None


def read(key: str, *, first: int | None = None) -> bytes:
    params: dict[str, Any] = {"Bucket": settings.MEDIA_BUCKET, "Key": key}
    if first is not None:
        params["Range"] = f"bytes=0-{first - 1}"
    body: bytes = client().get_object(**params)["Body"].read()
    return body


def put(key: str, data: bytes, mime: str) -> None:
    ensure_bucket()
    client().put_object(
        Bucket=settings.MEDIA_BUCKET, Key=key, Body=data, ContentType=mime
    )


def delete(key: str) -> None:
    client().delete_object(Bucket=settings.MEDIA_BUCKET, Key=key)
