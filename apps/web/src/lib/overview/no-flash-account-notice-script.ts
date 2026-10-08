import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  DISMISSED_VALUE,
} from './account-notice-dismissal'

/**
 * Runs in <head> before first paint; `=== '1'` must match wasAccountNoticeDismissed exactly. No
 * attribute cleanup only because there is no undo; an undo must remove the attribute.
 */
export const NO_FLASH_ACCOUNT_NOTICE_SCRIPT = `(function(){try{if(localStorage.getItem('${ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY}')==='${DISMISSED_VALUE}'){document.documentElement.setAttribute('${ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE}','${DISMISSED_VALUE}');}}catch(e){}})();`
