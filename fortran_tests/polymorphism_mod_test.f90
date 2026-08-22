module shapes
    implicit none
    type, abstract :: shape

    contains
        procedure(get_area_proc), deferred :: get_area
    end type

    abstract interface
        function get_area_proc(this) result(area)
            import :: shape
            class(shape), intent(in) :: this
            real :: area
        end function
    end interface

    type, extends(shape) :: square
        real :: side
    contains
        procedure :: get_area => square_area
    end type

contains
    function square_area(this) result(area)
        class(square), intent(in) :: this
        real :: area

        area = this%side**2
    end
end

