// Mock of src/firebase.js for local UI testing. Pretends the admin is signed in.
export const ADMIN_EMAIL = 'sapienscampus@gmail.com'
export const auth = {
  currentUser: {
    email: ADMIN_EMAIL,
    displayName: 'Mock Admin',
    photoURL: '',
    getIdToken: async () => 'mock-token',
  },
}
export const googleProvider = {}
export const app = {}
