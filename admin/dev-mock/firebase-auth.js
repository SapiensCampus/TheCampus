// Mock of 'firebase/auth': always signed in as the mock admin.
import { auth } from './firebase.js'

export const onAuthStateChanged = (_auth, cb) => {
  setTimeout(() => cb(auth.currentUser), 0)
  return () => {}
}
export const signInWithPopup = async () => ({ user: auth.currentUser })
export const signOut = async () => {}
export class GoogleAuthProvider {
  setCustomParameters() {}
}
export const getAuth = () => auth
