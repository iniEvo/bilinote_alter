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
      className="group relative flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] text-slate-600 transition-[background-color,color,box-shadow,transform] hover:bg-slate-100/80 hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=page]:bg-blue-50/80 aria-[current=page]:font-medium aria-[current=page]:text-blue-700 aria-[current=page]:shadow-[0_2px_8px_rgba(59,119,251,0.08)] aria-[current=page]:before:absolute aria-[current=page]:before:left-0 aria-[current=page]:before:top-2 aria-[current=page]:before:bottom-2 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-gradient-to-b aria-[current=page]:before:from-blue-500 aria-[current=page]:before:to-cyan-400"
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
