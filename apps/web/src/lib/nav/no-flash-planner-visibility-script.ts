import { PLANNER_VISIBILITY_STORAGE_KEY } from '../../stores/plannerVisibilityStore'

/**
 * Stores rehydrate after mount, so only a synchronous <head> script can hide the entry before first
 * paint. The rule is `=== false` and must match plannerVisibilityStore's coercion.
 */
/** `state` must be proven an object: a truthiness chain yields `false` for `{"state":false}`. */
export const NO_FLASH_PLANNER_SCRIPT = `(function(){try{var raw=localStorage.getItem('${PLANNER_VISIBILITY_STORAGE_KEY}');if(!raw)return;var parsed=JSON.parse(raw);var s=parsed&&typeof parsed==='object'?parsed.state:null;var v=s&&typeof s==='object'?s.showRetirementPlanner:undefined;if(v===false){document.documentElement.setAttribute('data-hide-retirement','1');}}catch(e){}})();`
