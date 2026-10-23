import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

app_logger = logging.getLogger("app")

# httpx logs every request's full URL at INFO. Speech to text sends the
# person's own habit, food and account names as Deepgram query parameters,
# so those lines would put personal data in the server log.
logging.getLogger("httpx").setLevel(logging.WARNING)
