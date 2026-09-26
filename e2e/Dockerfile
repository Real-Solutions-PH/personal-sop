# Thin wrapper over cypress/included: the image ships the Cypress binary and
# runner globally, so only the suite's extra devDependencies are added here.
# The tag must stay in lockstep with the exact "cypress" pin in package.json.
FROM cypress/included:15.18.1

WORKDIR /e2e

COPY e2e/package.json /e2e/

# npm (bundled in the image) resolves just the support deps; the Cypress
# binary itself is already baked in, so skip its download.
ENV CYPRESS_INSTALL_BINARY=0
RUN npm install --no-save \
    @testing-library/cypress@10.1.3 \
    dotenv@17.3.1 \
    typescript@5.9.3

# Copy the suite explicitly — never `COPY e2e /e2e`: the host's
# e2e/node_modules holds bun workspace SYMLINKS, and copying a symlink over
# the real node_modules npm just created fails the build outright.
COPY e2e/cypress /e2e/cypress
COPY e2e/cypress.config.ts e2e/tsconfig.json /e2e/

ENTRYPOINT ["cypress"]
CMD ["run"]
