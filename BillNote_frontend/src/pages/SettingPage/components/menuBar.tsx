import { FC, JSX } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface IMenuProps {
  id: string
  name: string
  icon: JSX.Element
  path: string
}

interface IMenuItem {
  menuItem: IMenuProps
}

const MenuBar: FC<IMenuItem> = ({ menuItem }) => {
  const location = useLocation()
  const isActive =
    location.pathname.startsWith(menuItem.path + '/') || location.pathname === menuItem.path

  return (
    <Link
      to={menuItem.path}
      aria-current={isActive ? 'page' : undefined}
      className="group flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] text-slate-600 transition-[background-color,color,box-shadow] hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=page]:bg-blue-50 aria-[current=page]:font-medium aria-[current=page]:text-blue-700 aria-[current=page]:shadow-sm aria-[current=page]:shadow-blue-100"
    >
      <span
        className="flex h-6 w-6 items-center justify-center transition-colors group-aria-[current=page]:text-blue-600"
        aria-hidden="true"
      >
        {menuItem.icon}
      </span>
      <span>{menuItem.name}</span>
    </Link>
  )
}

export default MenuBar
