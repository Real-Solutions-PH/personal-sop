export const randomEmail = () =>
  `test_${Math.random().toString(36).substring(7)}@example.com`

// padEnd: toString(36) can emit <8 chars, tripping GoTrue's minimum_password_length
export const randomPassword = () =>
  `${Math.random().toString(36).substring(2)}`.padEnd(10, "x")

export const randomItemTitle = () =>
  `Item ${Math.random().toString(36).substring(7)}`

export const randomItemDescription = () =>
  `Description ${Math.random().toString(36).substring(7)}`
