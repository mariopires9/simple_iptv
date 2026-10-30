// Module core/crypto — CredentialVault (SRC-01, ADR-006), see docs/ARCHITECTURE.md §4.
export {
  createCredentialVault,
  credentialVault,
  VaultKeyLostError,
  type CredentialVault,
  type CredentialVaultAdmin,
  type CredentialVaultDeps,
  type RekeyResult,
  type RekeyTarget,
  type VaultKeyLostReason,
} from './vault';
// Master password lock (SEC-02). The lock state is Dexie-free: the shell imports
// `@/core/crypto/lockState` directly to keep the database out of the initial bundle.
export {
  getMasterKey,
  getMasterKeyGeneration,
  getVaultLockStatus,
  MASTER_KID_PREFIX,
  resetVaultLock,
  setMasterKey,
  setVaultLocked,
  setVaultLockOff,
  subscribeVaultLock,
  VaultLockedError,
  whenVaultUnlocked,
  type MasterKey,
  type VaultLockStatus,
} from './lockState';
export {
  createMasterPassword,
  openMasterPassword,
  parseMasterPasswordConfig,
  WrongMasterPasswordError,
  type MasterPasswordConfig,
  type MasterPasswordDeps,
} from './masterPassword';
// Password-based encryption of data leaving the device (EXP-01 export file).
export {
  base64ToBytes,
  bytesToBase64,
  decryptWithPassword,
  derivePasswordKey,
  encryptWithPassword,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  PasswordDecryptError,
  type PasswordCipherDeps,
  type PasswordEnvelope,
} from './passwordCipher';
