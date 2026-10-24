const mockEnv = { executionEnvironment: "standalone" }
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get executionEnvironment() {
      return mockEnv.executionEnvironment
    },
  },
}))
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: { isRecognitionAvailable: () => true },
}))

import { recognitionModule } from "../speech"

test("a native build gets the recogniser", () => {
  mockEnv.executionEnvironment = "standalone"
  expect(recognitionModule()).not.toBeNull()
})

test("Expo Go never requires the recogniser it does not ship", () => {
  mockEnv.executionEnvironment = "storeClient"
  expect(recognitionModule()).toBeNull()
})
