/**
 * Site footer built on the Illinois Web Toolkit `<ilw-footer>`, matching the
 * standardized NCSA sites: the NCSA unit block (name, address, contact,
 * parent unit) and action links, followed by the campus-wide Illinois footer
 * that the toolkit renders automatically.
 */
export function SiteFooter() {
  return (
    <ilw-footer>
      <a slot="site-name" href="https://ncsa.illinois.edu">
        National Center for Supercomputing Applications
      </a>
      <address slot="address">
        <div>1205 W. Clark St.</div>
        <div>Urbana, Illinois 61801</div>
        <div>
          Email:{' '}
          <a href="mailto:illinois-computes@illinois.edu">
            illinois-computes@illinois.edu
          </a>
        </div>
      </address>
      <div slot="primary-unit">
        <a href="https://research.illinois.edu/">
          Office of the Vice Chancellor for Research and Innovation (OVCRI)
        </a>
      </div>
      <div slot="actions">
        <a href="https://computes.illinois.edu/" target="_blank" rel="noopener noreferrer">
          Illinois Computes
        </a>
        <a
          href="https://github.com/Center-for-AI-Innovation/LLMHub"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub Repository
        </a>
      </div>
    </ilw-footer>
  );
}
