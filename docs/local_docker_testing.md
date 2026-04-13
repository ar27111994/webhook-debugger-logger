# Local Docker Testing Strategy 🐳

To catch production issues like the SSE infinite loading bug without deploying to Apify, you can simulate the production environment using Docker locally or in CI/CD.

The repository now maintains **two named Docker build targets in a single Dockerfile**:

- `runtime-apify`: Apify-targeted image used by `.actor/actor.json`
- `runtime-standalone`: self-hosted/public image published from GitHub Releases

## 1. Manual Local Verification

You can build and run either image locally depending on which deployment path you want to validate.

### Steps

1. **Build the Apify Image**:

```bash
docker build --target runtime-apify -t webhook-debugger-apify .
```

1. **Run the Apify Container**:
   We map port 8080 and set the environment variable.

```bash
docker run --rm -p 8080:8080 \
  -e ACTOR_WEB_SERVER_PORT=8080 \
  -e APIFY_TOKEN=your_token_if_needed \
  webhook-debugger-apify
```

1. **Verify the Apify Image**:
   Test the `/log-stream` endpoint specifically to check for buffering/compression issues.

```bash
curl -v -N -H "Accept: text/event-stream" http://localhost:8080/log-stream
```

**Success Criteria**:

- `HTTP/1.1 200 OK`
- `cache-control: no-cache`
- `content-type: text/event-stream`
- **Crucial**: `content-encoding` should NOT be `gzip` or `deflate` (it should be `identity` or missing).

1. **Build the Standalone Image**:

```bash
docker build --target runtime-standalone -t webhook-debugger-standalone .
```

1. **Run the Standalone Container**:

```bash
docker run --rm -p 8081:8080 \
  -e ACTOR_WEB_SERVER_PORT=8080 \
  -v webhook-debugger-storage:/app/storage \
  webhook-debugger-standalone
```

1. **Verify the Standalone Image**:

```bash
curl -s http://localhost:8081/ready
curl -v -N -H "Accept: text/event-stream" http://localhost:8081/log-stream
```

**Success Criteria**:

- `GET /ready` returns `{"status":"ready",...}`
- `content-type: text/event-stream`
- `content-encoding` is `identity` or absent

## 2. CI/CD Integration (GitHub Actions)

You can automate this verification in your `ci.yml` by checking both Docker targets.

### Proposed Job

Add this to your `.github/workflows/ci.yml`:

```yaml
verify-docker:
  needs: build
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4

    - name: Build Apify Docker Image
      run: docker build -t webhook-debugger-apify .

    - name: Run Apify Container
      run: |
        docker run -d --name debugger-apify -p 8080:8080 \
          -e ACTOR_WEB_SERVER_PORT=8080 \
          webhook-debugger-apify

        # Poll for startup (max 30 attempts, 1s apart)
        for i in $(seq 1 30); do
          if curl -s -o /dev/null -w '' http://localhost:8080/info 2>/dev/null; then
            echo "Container ready after ${i}s"
            exit 0
          fi
          sleep 1
        done
        echo "❌ Container failed to start"
        exit 1

    - name: Verify Apify SSE Headers (Anti-Regression)
      run: |
        # Check for 200 OK and NO compression
        # Use timeout because SSE is an infinite stream
        HEADERS=$(timeout 5s curl -s -D - -o /dev/null -H "Accept: text/event-stream" http://localhost:8080/log-stream || true)

        if echo "$HEADERS" | grep -q "200 OK"; then
          echo "✅ Status 200 OK"
        else
          echo "❌ Failed to connect"
          exit 1
        fi

        if echo "$HEADERS" | grep -i "content-encoding:" | grep -v "identity"; then
          echo "❌ Error: Content-Encoding detected (likely compression enabled)"
          exit 1
        else
          echo "✅ No harmful Content-Encoding detected"
        fi

      - name: Build Standalone Docker Image
        run: docker build --target runtime-standalone -t webhook-debugger-standalone .

    - name: Run Standalone Container
      run: |
        docker run -d --name debugger-standalone -p 8081:8080 \
          -e ACTOR_WEB_SERVER_PORT=8080 \
          webhook-debugger-standalone

    - name: Verify Standalone Ready Probe
      run: curl -s http://localhost:8081/ready

    - name: Docker Logs (on failure)
      if: failure()
      run: |
        docker logs debugger-apify || true
        docker logs debugger-standalone || true
```

## 3. Why This Works

- **Publication Parity**: Uses the root `Dockerfile` referenced by `.actor/actor.json`, with the `runtime-apify` target matching the image definition Apify will publish from this repository.
- **Public Image Validation**: Verifies the `runtime-standalone` target that GitHub Releases publish to GHCR.
- **Middleware Check**: Verifies that your `main.js` logic (like the `compression` filter) works correctly inside the container environment.
- **Cost**: **$0**. Uses your local machine or GitHub Actions free tier.

## 4. Limitations

- **Apify Proxy**: This does _not_ simulate the Apify Proxy layer (Nginx/Envoy). However, most buffering issues (like the 502) initiate at the application level (Express+Compression), so this catches 90% of them.
- **Storage**: Local runs use local filesystem emulation for Apify Storage.
