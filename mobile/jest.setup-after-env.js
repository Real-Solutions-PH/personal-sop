// Runs after Jest's test globals exist (setupFilesAfterEnv), so Testing
// Library registers its own cleanup when it is first imported here.
//
// A `findBy*` / `waitFor` waits up to 1 s by default. Late in a loaded
// `--runInBand` CI run, a screen's first render with its mocked request can
// take longer, and a test fails with "Unable to find an element" while
// the element was on its way. A passing wait resolves the moment the
// element appears, so a longer limit only slows a real failure.
const { configure } = require("@testing-library/react-native")

configure({ asyncUtilTimeout: 10_000 })
