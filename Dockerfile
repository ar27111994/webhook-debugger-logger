# Specify the parent image from which we build
FROM apify/actor-node:20

# Copy source code
COPY . ./

# Install packages, skip optional and development dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed dependencies"

# Run the image
CMD [ "npm", "start", "--silent" ]
