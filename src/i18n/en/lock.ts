// SEC-02: master password — the unlock screen and its section in Settings › Privacy.
export const lock = {
  screen: {
    title: 'Simple IPTV is locked',
    message: 'Enter your master password to use your lists.',
    password: 'Master password',
    unlock: 'Unlock',
    unlocking: 'Unlocking…',
    wrong: 'That is not the master password. Try again.',
    failed: 'The app could not be unlocked. Try again.',
    forgotTitle: 'Forgot the master password?',
    forgotMessage:
      'It cannot be recovered. The only way back is to delete all data on this device and add your lists again.',
  },
  settings: {
    title: 'Master password',
    descriptionOff:
      'Protect your passwords and list addresses with a password only you know. The app asks for it when it opens and after some time in the background.',
    descriptionOn:
      'Your passwords and list addresses are encrypted with your master password. The app asks for it when it opens and after some time in the background.',
    enable: 'Set a master password…',
    disable: 'Turn off the master password…',
    lockNow: 'Lock now',
    lockAfter: 'Lock after, in the background',
    lockAfterChoice: (minutes: number) =>
      minutes === 0 ? 'Immediately' : minutes === 1 ? '1 minute' : `${minutes} minutes`,
    saveError: 'The setting could not be saved. Try again.',
    enableDialog: {
      title: 'Set a master password',
      warning:
        'There is no way to recover a forgotten master password. If you forget it, you will have to delete all data on this device and add your lists again.',
      password: 'Master password',
      passwordHint: (min: number) => `At least ${min} characters`,
      confirm: 'Repeat the master password',
      mismatch: 'The passwords do not match',
      tooShort: (min: number) => `Use at least ${min} characters`,
      understand: 'I understand that a forgotten master password cannot be recovered',
      submit: 'Set master password',
      working: 'Encrypting your credentials…',
      failed: 'The master password could not be set. Nothing was changed.',
    },
    disableDialog: {
      title: 'Turn off the master password?',
      message:
        'Your passwords and list addresses will be encrypted with this browser’s device key again. Enter the master password to confirm.',
      password: 'Master password',
      submit: 'Turn off',
      working: 'Re-encrypting your credentials…',
      wrong: 'That is not the master password.',
      failed: 'The master password could not be turned off. Nothing was changed.',
    },
  },
};
