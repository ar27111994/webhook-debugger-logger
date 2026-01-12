# Local Docker Testing Strategy 🐳

To catch production issues like the SSE infinite loading bug without deploying to Apify, you can simulate the production environment using Docker locally or in CI/CD.

## 1. Manual Local Verification

You can build and run the exact same Docker image that Apify uses.

### Steps

1.  **Build the Image**:

    ```bash
    docker build -t webhook-debugger .
    ```

2.  **Run the Container**:
    We map port 8080 and set the environment variable.

    ```bash
    docker run --rm -p 8080:8080 \
      -e ACTOR_WEB_SERVER_PORT=8080 \
      -e APIFY_TOKEN=your_token_if_needed \
      webhook-debugger
    ```

3.  **Verify**:
    Test the `/log-stream` endpoint specifically to check for buffering/compression issues.
    ```bash
    curl -v -N -H "Accept: text/event-stream" http://localhost:8080/log-stream
    ```
    **Success Criteria**:
    - `HTTP/1.1 200 OK`
    - `cache-control: no-cache`
    - `content-type: text/event-stream`
    - **Crucial**: `content-encoding` should NOT be `gzip` or `deflate` (it should be `identity` or missing).

## 2. CI/CD Integration (GitHub Actions)

You can automate this verification in your `ci.yml`.

### Proposed Job

Add this to your `.github/workflows/ci.yml`:

```yaml
verify-docker:
  needs: build
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4

    - name: Build Docker Image
      run: docker build -t webhook-debugger .

    - name: Run Container
      run: |
        docker run -d --name debugger -p 8080:8080 \
          -e ACTOR_WEB_SERVER_PORT=8080 \
          webhook-debugger

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

    - name: Verify SSE Headers (Anti-Regression)
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

    - name: Docker Logs (on failure)
      if: failure()
      run: docker logs debugger
```

## 3. Why This Works

- **Production Parity**: Uses `apify/actor-node:20` base image, same as production.
- **Middleware Check**: Verifies that your `main.js` logic (like the `compression` filter) works correctly inside the container environment.
- **Cost**: **$0**. Uses your local machine or GitHub Actions free tier.

## 4. Limitations

- **Apify Proxy**: This does _not_ simulate the Apify Proxy layer (Nginx/Envoy). However, most buffering issues (like the 502) initiate at the application level (Express+Compression), so this catches 90% of them.
- **Storage**: Local runs use local filesystem emulation for Apify Storage.
