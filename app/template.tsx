import BulkReviewInjector from './bulk-review-injector';
import SiteUpgrades from './site-upgrades';
import './site-upgrades.css';
export default function Template({children}:{children:React.ReactNode}){return <>{children}<BulkReviewInjector/><SiteUpgrades/></>}
