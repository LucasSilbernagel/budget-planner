import { OVERVIEW_DATA_STORES } from '../../stores/overview-data-storage-keys'

export const OVERVIEW_HAS_DATA_ATTRIBUTE = 'data-overview-has-data'

export const OVERVIEW_SECTIONS_PENDING_HOOK = 'overview-sections-pending'

/**
 * Makes the pending block viewport-tall for a browser holding data, so the Overview does not shift.
 * Counts rows across all profiles, unlike `hasData`: it errs toward a taller block.
 */
export const NO_FLASH_OVERVIEW_DATA_SCRIPT = `(function(){var s=${JSON.stringify(
	OVERVIEW_DATA_STORES
)};for(var i=0;i<s.length;i++){try{var raw=localStorage.getItem(s[i][0]);if(!raw)continue;var p=JSON.parse(raw);var rows=p&&p.state&&p.state[s[i][1]];if(Array.isArray(rows)&&rows.length>0){document.documentElement.setAttribute('${OVERVIEW_HAS_DATA_ATTRIBUTE}','1');return;}}catch(e){}}})();`
