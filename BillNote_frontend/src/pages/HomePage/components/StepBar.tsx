import { FC } from 'react'

interface Step {
  label: string
  key: string
  Icon?: React.ReactNode // 加一个可选的 Lottie 动画
}

interface StepBarProps {
  steps: Step[]
  currentStep: string
}

const StepBar: FC<StepBarProps> = ({ steps, currentStep }) => {
  const currentIndex = steps.findIndex(step => step.key === currentStep)

  return (
    <div className="flex w-full items-start justify-between">
      {steps.map((step, index) => {
        const isActive = index <= currentIndex
        const isCurrent = index === currentIndex
        return (
          <div key={step.key} className="relative flex flex-1 flex-col items-center">
            {/* 圆圈或者Lottie */}
            <div className="relative flex flex-col items-center justify-center">
              <div
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-white shadow-primary/30'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {index + 1}
              </div>
              {/* 当前步骤显示动画 */}
              {isCurrent && step.Icon && (
                <div className="pointer-events-none absolute top-10 h-16 w-16">{step.Icon}</div>
              )}
            </div>

            {/* 步骤名称 */}
            <div className={`mt-3 text-center text-xs transition-colors ${isCurrent ? 'font-medium text-primary' : 'text-slate-500'}`}>
              {step.label}
            </div>

            {/* 连接线：锚定在圆圈中心水平位置，避免负 margin 造成错位 */}
            <div
              className={`absolute top-4 -z-10 h-1 w-full rounded-full transition-colors ${
                index === 0 ? 'invisible' : isActive ? 'bg-primary' : 'bg-slate-200'
              }`}
            />
          </div>
        )
      })}
    </div>
  )
}

export default StepBar
