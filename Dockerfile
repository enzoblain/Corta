FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 DATA_DIR=/data
WORKDIR /srv
COPY app ./app
RUN useradd -r -u 1000 appuser && mkdir /data && chown appuser /data
USER appuser
EXPOSE 8000
HEALTHCHECK CMD python3 -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["python3", "-m", "app.server"]
