// Parental control (SEC-03): the PIN prompt, restricted-content gates and Settings › Parental
// control. Loaded with Live, Movies, Series and Settings.
export const parental = {
  /** Accessible name of a restricted category in the category navigation. */
  restrictedCategory: (name: string) => `${name} (restricted)`,
  gate: {
    title: 'Restricted content',
    message: 'This content is protected by the parental control PIN.',
    unlock: 'Enter PIN',
  },
  prompt: {
    title: 'Enter the PIN',
    pin: 'PIN',
    unlock: 'Unlock',
    cancel: 'Cancel',
    wrong: 'Wrong PIN. Try again.',
    error: 'The PIN could not be checked. Try again.',
  },
  settings: {
    title: 'Parental control',
    intro:
      'Set a PIN and choose the Live TV, Movies and Series categories it protects. Restricted categories and their items ask for the PIN before they are shown or played, and stay hidden from search and Home while locked.',
    deterrent:
      'This is a deterrent, not strong protection: someone with access to this device can get around it, for example by deleting the app data.',
    statusOff: 'No PIN set.',
    statusLocked: 'Locked: restricted content needs the PIN.',
    statusUnlocked: 'Unlocked until the app is closed or locked again.',
    setPin: 'Set PIN',
    changePin: 'Change PIN',
    removePin: 'Remove PIN',
    lockNow: 'Lock now',
    unlock: 'Unlock to edit',
    newPin: 'New PIN',
    newPinHint: '4 to 8 digits',
    confirmPin: 'Repeat the new PIN',
    currentPin: 'Current PIN',
    save: 'Save',
    cancel: 'Cancel',
    invalidPin: 'The PIN must have 4 to 8 digits.',
    mismatch: 'The two PINs are different.',
    wrongPin: 'Wrong PIN.',
    saveError: 'The change could not be saved. Try again.',
    pinSaved: 'PIN saved',
    pinRemoved: 'PIN removed',
    removeTitle: 'Remove the PIN',
    removeMessage: 'Every category becomes visible again and the restrictions are forgotten.',
    categories: 'Restricted categories',
    categoriesHint: (list: string) => `Of the active list (${list}).`,
    categoriesNoList: 'Add a list to choose its categories.',
    categoriesLocked: 'Unlock to see or change the restricted categories.',
    types: { live: 'Live TV', movie: 'Movies', series: 'Series' },
    /** Button that opens a type's category picker, with how many are restricted. */
    choose: (type: string, count: number) =>
      count === 0 ? `${type}: none restricted` : `${type}: ${count} restricted`,
    pickerTitle: (type: string) => `Restricted ${type} categories`,
    pickerEmpty: 'This list has no categories of this type.',
    uncategorized: 'Uncategorized',
    categoriesSaved: 'Restricted categories saved',
    forgot:
      'Forgot the PIN? It cannot be recovered: the only way to remove it is to delete all data.',
    forgotLink: 'Delete all data',
  },
};
