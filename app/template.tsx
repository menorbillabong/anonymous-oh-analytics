import BulkReviewInjector from './bulk-review-injector';
import SiteUpgrades from './site-upgrades';
import PostSortEnhancer from './post-sort-enhancer';
import SettingsPersistenceSync from './settings-persistence-sync';
import DatabaseRefreshTimer from './database-refresh-timer';
import './site-upgrades.css';
import './full-settings-v2.css';
import './color-customization.css';
export default function Template({children}:{children:React.ReactNode}){return <>{children}<BulkReviewInjector/><SiteUpgrades/><PostSortEnhancer/><SettingsPersistenceSync/><DatabaseRefreshTimer/></>}
