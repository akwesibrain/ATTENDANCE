import boxForLessLogo from '../assets/box-for-less-logo.png'
import doubleALogo from '../assets/double-a-logo.png'

/**
 * Companies available for self-registration at this stage.
 * In production this metadata will come from the backend.
 */
export const COMPANIES = [
  {
    id: 'box-for-less',
    name: 'Box For Less',
    initials: 'BFL',
    brandColor: '#0B3D91',
    logo: boxForLessLogo,
    description:
      'Retail and distribution workforce. Register to start using the Box For Less attendance system.',
  },
  {
    id: 'double-a',
    name: 'Double A',
    initials: 'DAA',
    brandColor: '#1C6FE0',
    logo: doubleALogo,
    description:
      'Operations and logistics workforce. Register to start using the Double A attendance system.',
  },
]

export function getCompanyById(companyId) {
  return COMPANIES.find((company) => company.id === companyId) ?? null
}
