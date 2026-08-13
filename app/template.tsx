import BulkReviewInjector from './bulk-review-injector';
import SiteUpgrades from './site-upgrades';
import PostSortEnhancer from './post-sort-enhancer';
import './site-upgrades.css';
import './full-settings-v2.css';
export default function Template({children}:{children:React.ReactNode}){return <>{children}<BulkReviewInjector/><SiteUpgrades/><PostSortEnhancer/></>}
